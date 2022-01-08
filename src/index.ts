import Client from "./client";
import { Buffer } from "buffer/";

export { Client };

export enum rawTypes {
  ACK,
  UDATA,
  URES,
  UBUF,
}

export function numToHex(num: number): Buffer {
  let hex = num.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  const numHex = Buffer.from(hex, "hex");
  return Buffer.concat([Buffer.from([numHex.length - 1]), numHex]);
}
