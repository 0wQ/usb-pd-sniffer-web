import type { MessageCategory } from "../types.js";

const CONTROL_MESSAGE_TYPES = new Map<number, string>([
  [0x01, "GoodCRC"],
  [0x03, "Accept"],
  [0x04, "Reject"],
  [0x06, "PS_RDY"],
  [0x07, "Get_Source_Cap"],
  [0x08, "Get_Sink_Cap"],
  [0x09, "DR_Swap"],
  [0x0a, "PR_Swap"],
  [0x0b, "VCONN_Swap"],
  [0x0c, "Wait"],
  [0x0d, "Soft_Reset"],
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

const DATA_MESSAGE_TYPES = new Map<number, string>([
  [0x01, "Source_Capabilities"],
  [0x02, "Request"],
  [0x03, "BIST"],
  [0x04, "Sink_Capabilities"],
  [0x05, "Battery_Status"],
  [0x06, "Alert"],
  [0x07, "Get_Country_Info"],
  [0x08, "Enter_USB"],
  [0x09, "EPR_Request"],
  [0x0a, "EPR_Mode"],
  [0x0b, "Source_Info"],
  [0x0c, "Revision"],
  [0x0f, "Vendor_Defined"],
]);

const EXTENDED_MESSAGE_TYPES = new Map<number, string>([
  [0x01, "Source_Capabilities_Extended"],
  [0x02, "Status"],
  [0x03, "Get_Battery_Cap"],
  [0x04, "Get_Battery_Status"],
  [0x05, "Battery_Capabilities"],
  [0x06, "Get_Manufacturer_Info"],
  [0x07, "Manufacturer_Info"],
  [0x08, "Security_Request"],
  [0x09, "Security_Response"],
  [0x0a, "Firmware_Update_Request"],
  [0x0b, "Firmware_Update_Response"],
  [0x0c, "PPS_Status"],
  [0x0d, "Country_Info"],
  [0x0e, "Country_Codes"],
  [0x0f, "Sink_Capabilities_Extended"],
  [0x10, "Extended_Control"],
  [0x11, "EPR_Source_Capabilities"],
  [0x12, "EPR_Sink_Capabilities"],
  [0x1e, "Vendor_Defined_Extended"],
]);

export function lookupMessageTypeName(
  category: MessageCategory,
  code: number,
): string | null {
  if (category === "control") {
    return CONTROL_MESSAGE_TYPES.get(code) ?? null;
  }

  if (category === "data") {
    return DATA_MESSAGE_TYPES.get(code) ?? null;
  }

  if (category === "extended") {
    return EXTENDED_MESSAGE_TYPES.get(code) ?? null;
  }

  return null;
}
