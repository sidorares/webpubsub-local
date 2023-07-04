import WebSocket, { WebSocketServer } from "ws";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import express from "express";
import bodyParser from "body-parser";
import { createServer } from "http";
import users from "./users.json" assert { type: "json" };

const PORT = process.env.PORT || 8080;
const allHubs = new Map();

function sendToGroup({ hubName, groupName, message }) {
  console.log("sendToGroup", { hubName, groupName, message });
  const hub = allHubs.get(hubName);
  if (!hub) {
    return;
  }
  const group = hub.groups.get(groupName);
  if (!group) {
    return;
  }
  try {
    group.forEach((connectionId) => {
      console.log("sending to connection", connectionId);
      const connection = hub.clients.get(connectionId);
      if (connection) {
        connection.ws.send(
          JSON.stringify({
            type: "message",
            from: "group",
            fromUserId: null,
            group: groupName,
            dataType: "json",
            data: message,
          })
        );
      }
    });
  } catch (err) {
    console.log(err);
  }
}

const app = new express();
const jsonParser = bodyParser.json();

// TODO: add other rest APIs
// https://learn.microsoft.com/en-us/rest/api/webpubsub/dataplane/web-pub-sub/send-to-connection?tabs=HTTP

const jwtMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    res.status(401).send("Unauthorized");
    return;
  }
  // const decoded = jwt.decode(token.split(" ")[1]);
  if (!decoded) {
    res.status(401).send("Unauthorized");
    return;
  }
  req.userId = decoded.sub;
  req.role = decoded.role || [];
  const joinLeaveGroup = new Set();
  const sendToGroup = new Set();
  const sendToConnection = new Set();
  req.role.forEach((role) => {
    const [_, type, query] = role.split(".");
    if (type === "joinLeaveGroup") {
      joinLeaveGroup.add(query);
    } else if (type === "sendToGroup") {
      sendToGroup.add(query);
    } else if (type === "sendToConnection") {
      sendToConnection.add(query);
    }
  });
  req.canJoinGroup = (group) => joinLeaveGroup.has(group);
  req.canSendToGroup = (group) => sendToGroup.has(group);
  req.canSendToConnection = (connectionId) =>
    sendToConnection.has(connectionId);
  next();
};

app.post(
  "/api/hubs/:hubName/:method",
  jwtMiddleware,
  jsonParser,
  (req, resp) => {
    console.log("!!!!!!", req.url);
    const { method } = req.params;
    if (method === ":send") {
      const body = req.body;
      // TODO send to all connections in a hub
      resp.status(202).end("");
    }
  }
);

app.post(
  "/api/hubs/:hubName/:method",
  jwtMiddleware,
  jsonParser,
  (req, resp) => {
    console.log("######", req.url);
    const { method } = req.params;
    if (method === ":send") {
      const body = req.body;
      // TODO send to all connections in a hub
      resp.status(202).end("");
    }
  }
);

app.post(
  "/api/hubs/:hubName/groups/:groupId/:method",
  jwtMiddleware,
  jsonParser,
  (req, resp) => {
    const { hubName, groupId, method } = req.params;
    if (method === ":send") {
      sendToGroup({ hubName, groupName: groupId, message: req.body });
      resp.status(202).end();
    }
  }
);

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

const authenticate = (request, next) => {
  console.log(request.url);
  const url = new URL(request.url, "http://dummybase");
  const token = url.searchParams.get("access_token");
  if (!token) {
    console.log("Error: token not supplied");
    next(false, 401, "Unauthorized");
    return;
  }
  const hub = url.pathname.split("/").slice(-1)[0];
  const connectionId = crypto.randomUUID();
  try {
    const decoded = jwt.decode(token, token);
    console.log(decoded);
    const url = new URL(decoded.aud);
    const hub = url.pathname.split("/").slice(-1)[0];

    // 
    
    next(null, { role: decoded.role, userId: decoded.sub, hub, connectionId });
  } catch (err) {
    next(err);
  }
};

wss.on("connection", function connection(ws, request, client) {
  // todo: set in authenticate?
  client.ws = ws;

  if (!allHubs.has(client.hub)) {
    allHubs.set(client.hub, {
      clients: new Map(),
      groups: new Map(),
    });
  }
  allHubs.get(client.hub).clients.set(client.connectionId, client);

  ws.send(
    JSON.stringify({
      type: "system",
      event: "connected",
      userId: client.userId,
      connectionId: client.connectionId,
    })
  );

  // {"type":"message","from":"group","group":"56c09a2f-04cf-44f1-aef7-f0657b6dd7f2","dataType":"json","data":{"type":"screencastFrame","hash":"ebddca0e3f389ab86a9d1ed34dffd0e00af2bfd0"}}

  ws.on("message", function message(msg) {
    const message = JSON.parse(msg);
    switch (message.type) {
      case "joinGroup": {
        console.log(`Join group ${message.group}`, message);
        const subscribers =
          allHubs.get(client.hub).groups.get(message.group) || new Set();
        subscribers.add(client.connectionId);
        allHubs.get(client.hub).groups.set(message.group, subscribers);
        break;
      }
      case "leaveGroup": {
        const subscribers = allHubs.get(client.hub).groups.get(message.group);
        if (subscribers) {
          subscribers.delete(client.connectionId);
          console.log(`Leave group ${message.group}`);
        }
        break;
      }
      case "sendToGroup": {
        const groupName = message.group;
        const hubName = client.hub;
        sendToGroup({ hubName, groupName, message: message.data });
        break;
      }
      default:
        console.log("Unknown message!", message);
    }
  });

  ws.on("close", function close() {
    console.log(`Close connection ${client.connectionId}`);
    allHubs.get(client.hub).clients.delete(client.connectionId);
    // TODO: add connectionId to groups index
    allHubs
      .get(client.hub)
      .groups.forEach((group) => group.delete(client.connectionId));
  });
});

server.on("upgrade", function upgrade(request, socket, head) {
  console.log("Here!");
  authenticate(request, (err, client) => {
    if (err || !client) {
      console.log("authenticate error:", err);
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, function done(ws) {
      wss.emit("connection", ws, request, client);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  if (process.send) {
    process.send("server:listening");
  }
});
