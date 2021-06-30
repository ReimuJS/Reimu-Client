import * as msgpack from "msgpack-lite";
import { Reimu } from "..";

export default class Message {
  constructor(event: MessageEvent, client: Reimu) {
    this.reimu = client;

    let decoded: any;
    try {
      decoded = msgpack.decode(new Uint8Array(event.data));
    } catch (e) {
      this.reimu.disconnect(1002);
    }
    if (!decoded) return;

    if (!decoded.type) {
      this.reimu.disconnect(1002);
      return;
    }

    this.data = decoded.data;

    if (decoded.id == undefined) {
      if (!decoded.for) {
        this.reimu.disconnect(1002);
        return;
      }
      this.id = decoded.for;

      switch (decoded.type) {
        case "acknoledge":
          const droppedPacket = this.reimu.droppedPackets.find(
            (data) => data.id == decoded.replyFor
          );
          if (!droppedPacket) return;
          this.reimu.droppedPackets.splice(
            this.reimu.droppedPackets.indexOf(droppedPacket),
            1
          );
          break;

        default:
          this.reimu.disconnect(1002);
          break;
      }

      const initialMessage = this.reimu.awaitCallback.find(
        (data) => data.id == decoded.replyFor
      );

      if (!initialMessage) return;
      this.reimu.awaitCallback.splice(
        this.reimu.awaitCallback.indexOf(initialMessage),
        1
      );
      switch (decoded.type) {
        case "acknoledge":
          if (initialMessage.callback.type != "acknoledge") return;
          initialMessage.callback.cb();
          break;
        case "response":
          if (initialMessage.callback.type != "response") return;
          initialMessage.callback.cb(this);
          break;

        default:
          this.reimu.disconnect(1002);
          return;
      }
    } else {
      this.id = decoded.id;

      switch (decoded.type) {
        case "message":
          this.reimu.emit("message", decoded.data);
          break;

        default:
          this.reimu.disconnect(1002);
          return;
      }
    }
  }

  // Variables

  private reimu!: Reimu;

  /**
   * The message id
   * @type {number}
   * @readonly
   */
  public id!: number;

  /**
   * The message data
   * @type {any}
   */
  public data: any;

  // Functions

  /**
   * Responds to the message.
   * @param {any} data - Data to be sent
   * @returns {void}
   */
  public respond(data: any): void {
    this.reimu.respond(data, this);
  }
}
