function createSseHub() {
  const clients = new Set();

  function connect(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n");
    res.write("event: connected\n");
    res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  }

  function publish(eventName, payload) {
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(frame);
  }

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(`: heartbeat ${Date.now()}\n\n`);
  }, 25000);
  heartbeat.unref();

  return { connect, publish };
}

module.exports = { createSseHub };
