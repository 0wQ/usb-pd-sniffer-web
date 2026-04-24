// @ts-nocheck
import { describe, expect, test } from "vitest";
import { lookupMessageTypeName } from "./messageTypes.js";

describe("lookupMessageTypeName", () => {
  test("covers all spec-defined control message names through Get_Revision", () => {
    const expectedControlTypes = new Map<number, string>([
      [0x01, "GoodCRC"],
      [0x02, "GotoMin"],
      [0x03, "Accept"],
      [0x04, "Reject"],
      [0x05, "Ping"],
      [0x06, "PS_RDY"],
      [0x07, "Get_Source_Cap"],
      [0x08, "Get_Sink_Cap"],
      [0x09, "DR_Swap"],
      [0x0a, "PR_Swap"],
      [0x0b, "VCONN_Swap"],
      [0x0c, "Wait"],
      [0x0d, "Soft_Reset"],
      [0x0e, "Data_Reset"],
      [0x0f, "Data_Reset_Complete"],
      [0x10, "Not_Supported"],
      [0x11, "Get_Source_Cap_Extended"],
      [0x12, "Get_Status"],
      [0x13, "FR_Swap"],
      [0x14, "Get_PPS_Status"],
      [0x15, "Get_Country_Codes"],
      [0x16, "Get_Sink_Cap_Extended"],
      [0x17, "Get_Source_Info"],
      [0x18, "Get_Revision"],
    ]);

    for (const [code, expectedName] of expectedControlTypes) {
      expect(lookupMessageTypeName("control", code)).toBe(expectedName);
    }

    expect(lookupMessageTypeName("control", 0x00)).toBeNull();
    expect(lookupMessageTypeName("control", 0x19)).toBeNull();
  });
});
