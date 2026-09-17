import { describe, it, expect, vi, beforeEach } from "vitest";
import * as GitInterfaces from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { CreateReviewCommentInput } from "../../vendor/shared/adapters.js";
import { ValidationError } from "../../platform/errors.js";
import {
  publishThreadComment,
  listThreadComments,
  assertEnglishBody,
  type ThreadRepoContext,
} from "./threads.js";

/**
 * TASK-008 — hermetic unit tests for the ADO thread-publishing module. No
 * network calls: `ThreadRepoContext.git` is a hand-built fake with `vi.fn()`
 * methods, matching the shapes CONFIRMED against a real Azure DevOps
 * organization during TASK-008 development (org GES-IT, repo
 * ges-azure-functions, PR #6557) — most importantly the `$type`/`$value`
 * properties wire shape and the fact that `updateThread` rejects any request
 * carrying a `properties` field once a thread already exists. Both are
 * documented in threads.ts's module doc comment; these tests are what pins
 * that discovery so a future refactor cannot silently reintroduce either
 * mistake.
 */

function fakeGit() {
  return {
    getThreads: vi.fn(),
    createThread: vi.fn(),
    createComment: vi.fn(),
    updateThread: vi.fn(),
  };
}

function ctxFor(git: ReturnType<typeof fakeGit>, overrides: Partial<ThreadRepoContext> = {}): ThreadRepoContext {
  return {
    git: git as never,
    repositoryId: "ges-azure-functions",
    project: "Big_Commerce_Remediation",
    pullRequestId: 6557,
    repo: {
      owner: "GES-IT",
      name: "ges-azure-functions",
      project: "Big_Commerce_Remediation",
      baseUrl: "https://dev.azure.com",
    },
    baseUrl: "https://dev.azure.com",
    changeTrackingIdByPath: {
      "/apps/order-functions/src/functions/order-processing/order-processing-handler.ts": 8,
    },
    ...overrides,
  };
}

const INPUT: CreateReviewCommentInput = {
  commitId: "9560d1706ae89d341e868a0291eed66bd165bfbc",
  path: "apps/order-functions/src/functions/order-processing/order-processing-handler.ts",
  line: 124,
  body: "This loop got turned into a Promise.all — the sibling branches keep running even after one throws.",
  severity: "warning",
  title: "Promise.all loses per-branch failure isolation",
};

/** A live thread shaped like what `createThread` and `getThreads` actually
 *  return for a thread this module created — `$type`/`$value` properties, a
 *  RIGHT-side threadContext, one Text comment. */
function existingThread(
  findingIdValue: string,
  overrides: Partial<GitInterfaces.GitPullRequestCommentThread> = {},
): GitInterfaces.GitPullRequestCommentThread {
  return {
    id: 36658,
    status: GitInterfaces.CommentThreadStatus.Active,
    isDeleted: false,
    threadContext: {
      filePath: "/apps/order-functions/src/functions/order-processing/order-processing-handler.ts",
      rightFileStart: { line: 124, offset: 1 },
      rightFileEnd: { line: 124, offset: 1 },
    },
    properties: {
      "devdigest.findingId": { $type: "System.String", $value: findingIdValue },
    } as never,
    comments: [
      {
        id: 1,
        content: "existing text",
        commentType: GitInterfaces.CommentType.Text,
        isDeleted: false,
        author: { displayName: "Some Reviewer" },
        publishedDate: new Date("2026-09-01T00:00:00Z"),
      },
    ],
    ...overrides,
  };
}

describe("assertEnglishBody", () => {
  it("accepts plain English text", () => {
    expect(() => assertEnglishBody(INPUT.body)).not.toThrow();
  });

  it("rejects Cyrillic text (the real leak this project hit)", () => {
    expect(() =>
      assertEnglishBody("Последовательный цикл заменён на Promise.all."),
    ).toThrow(ValidationError);
  });

  it("does not false-positive on an em dash or curly punctuation in English prose", () => {
    expect(() =>
      assertEnglishBody("This is fine — it's just an em dash and an apostrophe."),
    ).not.toThrow();
  });
});

describe("publishThreadComment — new finding", () => {
  let git: ReturnType<typeof fakeGit>;

  beforeEach(() => {
    git = fakeGit();
    git.getThreads.mockResolvedValue([]); // no existing thread for this finding
  });

  it("rejects a non-English body before making any network call", async () => {
    const ctx = ctxFor(git);
    await expect(
      publishThreadComment(ctx, { ...INPUT, body: "Это на русском." }),
    ).rejects.toThrow(ValidationError);
    expect(git.getThreads).not.toHaveBeenCalled();
    expect(git.createThread).not.toHaveBeenCalled();
  });

  it("creates a thread with properties in the $type/$value shape", async () => {
    git.createThread.mockResolvedValue(existingThread("whatever-the-real-hash-is"));
    const ctx = ctxFor(git);

    await publishThreadComment(ctx, INPUT);

    expect(git.createThread).toHaveBeenCalledTimes(1);
    const [threadArg, repoId, prId, project] = git.createThread.mock.calls[0]!;
    expect(repoId).toBe("ges-azure-functions");
    expect(prId).toBe(6557);
    expect(project).toBe("Big_Commerce_Remediation");
    expect(threadArg.properties).toEqual({
      "devdigest.findingId": { $type: "System.String", $value: expect.any(String) },
    });
    // The dangerous-looking-but-wrong shape must never appear.
    expect(JSON.stringify(threadArg.properties)).not.toContain('"type"');
    expect(JSON.stringify(threadArg.properties)).not.toContain('"value"');
  });

  it("positions a RIGHT-side comment via rightFileStart/rightFileEnd", async () => {
    git.createThread.mockResolvedValue(existingThread("x"));
    await publishThreadComment(ctxFor(git), { ...INPUT, side: "RIGHT" });
    const [threadArg] = git.createThread.mock.calls[0]!;
    expect(threadArg.threadContext.rightFileStart).toEqual({ line: 124, offset: 1 });
    expect(threadArg.threadContext.leftFileStart).toBeUndefined();
  });

  it("positions a LEFT-side comment via leftFileStart/leftFileEnd", async () => {
    git.createThread.mockResolvedValue(existingThread("x"));
    await publishThreadComment(ctxFor(git), { ...INPUT, side: "LEFT" });
    const [threadArg] = git.createThread.mock.calls[0]!;
    expect(threadArg.threadContext.leftFileStart).toEqual({ line: 124, offset: 1 });
    expect(threadArg.threadContext.rightFileStart).toBeUndefined();
  });

  it("includes pullRequestThreadContext.changeTrackingId when the path is known", async () => {
    git.createThread.mockResolvedValue(existingThread("x"));
    await publishThreadComment(ctxFor(git), INPUT);
    const [threadArg] = git.createThread.mock.calls[0]!;
    expect(threadArg.pullRequestThreadContext).toEqual({ changeTrackingId: 8 });
  });

  it("degrades gracefully — creates the thread without pullRequestThreadContext when changeTrackingId is unknown (R-D)", async () => {
    git.createThread.mockResolvedValue(existingThread("x"));
    const ctx = ctxFor(git, { changeTrackingIdByPath: {} });
    await publishThreadComment(ctx, INPUT);
    const [threadArg] = git.createThread.mock.calls[0]!;
    expect(threadArg.pullRequestThreadContext).toBeUndefined();
  });

  it("returns a PrReviewComment with the correct discussionId html_url (R37)", async () => {
    git.createThread.mockResolvedValue(existingThread("x", { id: 42 }));
    const result = await publishThreadComment(ctxFor(git), INPUT);
    expect(result.html_url).toBe(
      "https://dev.azure.com/GES-IT/Big_Commerce_Remediation/_git/ges-azure-functions/pullrequest/6557?discussionId=42",
    );
    expect(result.thread_id).toBe(42);
  });
});

describe("publishThreadComment — same finding published twice (R33)", () => {
  it("finds the existing thread and adds a comment — does NOT call createThread or updateThread-with-properties", async () => {
    const git = fakeGit();
    const thread = existingThread("will-match");
    git.getThreads.mockResolvedValue([thread]);
    git.createComment.mockResolvedValue({
      id: 2,
      content: INPUT.body,
      commentType: GitInterfaces.CommentType.Text,
      author: { displayName: "DevDigest" },
      publishedDate: new Date(),
    });

    // The matching logic hashes `input` against `findingId(...)`, so for
    // this test to exercise the match path the fixture's stored value must
    // equal whatever `publishThreadComment` will compute for `INPUT` — spy
    // on `getThreads` returning a thread whose property is intentionally
    // wired to match by re-reading it back out is brittle; instead this
    // test asserts the SHAPE of the update-path calls given a match is
    // found, using a thread the test controls to always match by mocking
    // `getThreads` to return exactly one thread regardless of its property
    // value is not representative — so this test drives the real matching
    // by first publishing once (unmocked create), reading the real
    // `properties` off the mock's own createThread call, then feeding that
    // exact thread back through `getThreads`.
    const createThreadGit = fakeGit();
    createThreadGit.getThreads.mockResolvedValue([]);
    createThreadGit.createThread.mockImplementation(async (t: GitInterfaces.GitPullRequestCommentThread) => ({
      ...t,
      id: 36658,
      comments: t.comments!.map((c, i) => ({ ...c, id: i + 1 })),
    }));
    await publishThreadComment(ctxFor(createThreadGit), INPUT);
    const createdThread = createThreadGit.createThread.mock.results[0]!.value;

    const republishGit = fakeGit();
    republishGit.getThreads.mockResolvedValue([await createdThread]);
    republishGit.createComment.mockResolvedValue({
      id: 2,
      content: INPUT.body,
      commentType: GitInterfaces.CommentType.Text,
      author: { displayName: "DevDigest" },
      publishedDate: new Date(),
    });

    const result = await publishThreadComment(ctxFor(republishGit), INPUT);

    expect(republishGit.createThread).not.toHaveBeenCalled();
    expect(republishGit.createComment).toHaveBeenCalledTimes(1);
    const [commentArg, repoId, prId, threadId] = republishGit.createComment.mock.calls[0]!;
    expect(commentArg.content).toBe(INPUT.body);
    expect(threadId).toBe(36658);
    // The thread was already Active, so no status-only PATCH is needed.
    expect(republishGit.updateThread).not.toHaveBeenCalled();
    expect(result.thread_id).toBe(36658);
  });

  it("never sends a `properties` field to updateThread, even when a status nudge IS needed", async () => {
    const git = fakeGit();
    const thread = existingThread("match", { status: GitInterfaces.CommentThreadStatus.Fixed });
    git.getThreads.mockResolvedValue([thread]);
    git.createComment.mockResolvedValue({
      id: 2,
      content: INPUT.body,
      commentType: GitInterfaces.CommentType.Text,
    });
    git.updateThread.mockResolvedValue({ ...thread, status: GitInterfaces.CommentThreadStatus.Active });

    // Force the match by making findThreadByFindingId's lookup succeed:
    // reuse the real create -> republish flow as above, but start the
    // existing thread in a non-Active status.
    const createThreadGit = fakeGit();
    createThreadGit.getThreads.mockResolvedValue([]);
    createThreadGit.createThread.mockImplementation(async (t: GitInterfaces.GitPullRequestCommentThread) => ({
      ...t,
      id: 36659,
      status: GitInterfaces.CommentThreadStatus.Fixed,
      comments: t.comments!.map((c, i) => ({ ...c, id: i + 1 })),
    }));
    await publishThreadComment(ctxFor(createThreadGit), INPUT);
    const createdThread = await createThreadGit.createThread.mock.results[0]!.value;

    const republishGit = fakeGit();
    republishGit.getThreads.mockResolvedValue([createdThread]);
    republishGit.createComment.mockResolvedValue({ id: 2, content: INPUT.body });
    republishGit.updateThread.mockResolvedValue({ ...createdThread, status: GitInterfaces.CommentThreadStatus.Active });

    await publishThreadComment(ctxFor(republishGit), INPUT);

    expect(republishGit.updateThread).toHaveBeenCalledTimes(1);
    const [patchArg] = republishGit.updateThread.mock.calls[0]!;
    expect(patchArg).not.toHaveProperty("properties");
    expect(patchArg).toEqual({ status: GitInterfaces.CommentThreadStatus.Active });
  });
});

describe("publishThreadComment — two distinct findings on the same line (R34/AC-008-5)", () => {
  it("creates two separate threads when severity/title differ, even at the same path:line", async () => {
    const git = fakeGit();
    git.getThreads.mockResolvedValue([]); // neither finding has a thread yet
    git.createThread
      .mockResolvedValueOnce(existingThread("a", { id: 1 }))
      .mockResolvedValueOnce(existingThread("b", { id: 2 }));

    const first = await publishThreadComment(ctxFor(git), INPUT);
    const second = await publishThreadComment(ctxFor(git), {
      ...INPUT,
      title: "A completely different finding on the same line",
    });

    expect(git.createThread).toHaveBeenCalledTimes(2);
    expect(first.thread_id).not.toBe(second.thread_id);
  });
});

describe("publishThreadComment — reply (R34/R36)", () => {
  it("posts directly to the named thread without matching by findingId first", async () => {
    const git = fakeGit();
    git.createComment.mockResolvedValue({
      id: 5,
      content: "A free-form reply.",
      commentType: GitInterfaces.CommentType.Text,
      author: { displayName: "Reviewer" },
      publishedDate: new Date(),
    });
    git.getThreads.mockResolvedValue([existingThread("irrelevant", { id: 36658 })]);

    const result = await publishThreadComment(ctxFor(git), {
      ...INPUT,
      body: "A free-form reply.",
      inReplyTo: 36658,
    });

    expect(git.createComment).toHaveBeenCalledTimes(1);
    const [, , , threadIdArg] = git.createComment.mock.calls[0]!;
    expect(threadIdArg).toBe(36658);
    expect(result.thread_id).toBe(36658);
    // getThreads IS called (to build the response), but only AFTER the
    // reply, not as a pre-publish idempotency lookup — createThread is
    // never invoked either way.
    expect(git.createThread).not.toHaveBeenCalled();
  });
});

describe("listThreadComments (R35/AC-008-6)", () => {
  it("excludes System-type comments (ADO's own auto-generated notices)", async () => {
    const git = fakeGit();
    git.getThreads.mockResolvedValue([
      existingThread("a", {
        id: 1,
        comments: [
          {
            id: 1,
            content: "PR updated",
            commentType: GitInterfaces.CommentType.System,
            isDeleted: false,
          },
        ],
      }),
      existingThread("b", { id: 2 }), // default: one Text comment
    ]);

    const result = await listThreadComments(ctxFor(git));

    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe("existing text");
  });

  it("excludes deleted comments and deleted threads", async () => {
    const git = fakeGit();
    git.getThreads.mockResolvedValue([
      existingThread("a", { id: 1, isDeleted: true }),
      existingThread("b", {
        id: 2,
        comments: [
          { id: 1, content: "gone", commentType: GitInterfaces.CommentType.Text, isDeleted: true },
          { id: 2, content: "still here", commentType: GitInterfaces.CommentType.Text, isDeleted: false },
        ],
      }),
    ]);

    const result = await listThreadComments(ctxFor(git));

    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe("still here");
  });
});
