import { Reimu } from "..";

export default class Message {
  constructor(message: any, client: Reimu) {
    this.reimu = client;

    if (!message.type) {
      this.reimu.disconnect(1002);
      return;
    }

    if (message.type == "batch") {
      if (!Array.isArray(message.data)) client.disconnect(1002);
      else {
        for (const msg of message) {
          new Message(msg, client);
        }
      }
      return;
    }

    this.data = message.data;

    if (message.id == undefined) {
      if (!message.for) {
        this.reimu.disconnect(1002);
        return;
      }
      this.id = message.for;

      switch (message.type) {
        case "acknoledge":
          const droppedPacket = this.reimu.droppedPackets.find(
            (data) => data.id == message.replyFor
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
        (data) => data.id == message.replyFor
      );

      if (!initialMessage) return;
      this.reimu.awaitCallback.splice(
        this.reimu.awaitCallback.indexOf(initialMessage),
        1
      );
      switch (message.type) {
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
      this.id = message.id;

      switch (message.type) {
        case "message":
          this.reimu.emit("message", message.data);
          break;
        case "hello":
          this.reimu.emit("connect");
          this.reimu.id = this.reimu.id || message.data.id;
          this.respond({ id: this.reimu.id });
          break;
        case "close":
          this.reimu.close = { code: message.data.code, server: false };
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
