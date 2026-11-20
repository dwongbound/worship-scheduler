import { describe, expect, it } from "vitest";
import { groupChatUserIds, parseChatMemberIds } from "@/lib/groupChatMembers";

describe("groupChatUserIds", () => {
  it("adds the recurring set's extras to the people on the set", () => {
    expect(groupChatUserIds(["a", "b"], ["lead"])).toEqual(["a", "b", "lead"]);
  });
  it("lists someone who is both only once", () => {
    expect(groupChatUserIds(["a", "lead"], ["lead"])).toEqual(["a", "lead"]);
  });
  it("a set with no recurring list is just its people", () => {
    expect(groupChatUserIds(["a"], [])).toEqual(["a"]);
  });
});

describe("parseChatMemberIds", () => {
  it("absent leaves the list alone", () => {
    expect(parseChatMemberIds(undefined)).toBeNull();
  });
  it("de-dupes ids", () => {
    expect(parseChatMemberIds(["u1", "u1", "u2"])).toEqual(["u1", "u2"]);
  });
  it("refuses anything but ids", () => {
    expect(parseChatMemberIds(["u1", 3])).toBeNull();
    expect(parseChatMemberIds("u1")).toBeNull();
  });
  it("an empty list clears it", () => {
    expect(parseChatMemberIds([])).toEqual([]);
  });
});
