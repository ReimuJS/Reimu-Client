export default function Client<MessageType>(
  endpoint: string,
  options?: Partial<options<MessageType>>
) {
  const opts: options<MessageType> = {
    reconnectTimeout: 40,
    ...options,
  };

  let ws: WebSocket;
  let id: string | null = null;

  function Open(newId: boolean = false) {
    if (newId) id = null;
    if (ws) {
      // Discard the old socket entirely
      ws.onopen = () => {};
      ws.onmessage = () => {};
      ws.onerror = () => {};
      ws.onclose = () => {};
      ws.close();
    }

    ws = new WebSocket(endpoint);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (newId || !id) {
        ws.send("hello");
      } else {
        ws.send(id);
      }
    };
  }

  Open(true);
}

export interface options<MessageType> {
  /** Maximum time in seconds that the client can be disconnected before it will no longer be allowed to reconnect. Defaults to 40. */
  reconnectTimeout: number;
}
