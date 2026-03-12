import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // State
  let onlineUsers = new Set();
  let matchingQueue: string[] = [];
  let activeChats: { [roomId: string]: { users: string[], messages: any[] } } = {};

  io.on("connection", (socket) => {
    onlineUsers.add(socket.id);
    io.emit("onlineCount", onlineUsers.size);

    socket.on("joinQueue", () => {
      if (matchingQueue.includes(socket.id)) return;

      if (matchingQueue.length > 0) {
        const partnerId = matchingQueue.shift()!;
        const roomId = `room_${Math.random().toString(36).substring(7)}`;
        
        activeChats[roomId] = {
          roomId,
          users: [socket.id, partnerId],
          messages: []
        };

        socket.join(roomId);
        io.to(partnerId).emit("matched", { roomId, partnerId: socket.id });
        socket.emit("matched", { roomId, partnerId });
        
        io.sockets.sockets.get(partnerId)?.join(roomId);
      } else {
        matchingQueue.push(socket.id);
        socket.emit("waiting");
      }
    });

    socket.on("leaveQueue", () => {
      matchingQueue = matchingQueue.filter(id => id !== socket.id);
    });

    socket.on("sendMessage", ({ roomId, text }) => {
      if (activeChats[roomId]) {
        const message = {
          id: Math.random().toString(36).substring(7),
          sender: socket.id,
          text,
          timestamp: new Date().toISOString()
        };
        activeChats[roomId].messages.push(message);
        io.to(roomId).emit("message", message);
        
        // Notify admin of update
        io.to("admin_room").emit("chatUpdate", { roomId, ...activeChats[roomId] });
      }
    });

    socket.on("leaveChat", (roomId) => {
      socket.leave(roomId);
      io.to(roomId).emit("partnerLeft");
      delete activeChats[roomId];
      io.to("admin_room").emit("chatEnded", roomId);
    });

    // Admin logic
    socket.on("adminLogin", (code) => {
      if (code === "676476") {
        socket.join("admin_room");
        socket.emit("adminAuthSuccess", activeChats);
      } else {
        socket.emit("adminAuthFail");
      }
    });

    socket.on("disconnect", () => {
      onlineUsers.delete(socket.id);
      io.emit("onlineCount", onlineUsers.size);
      
      // Remove from queue
      matchingQueue = matchingQueue.filter(id => id !== socket.id);
      
      // Handle active chats
      for (const roomId in activeChats) {
        if (activeChats[roomId].users.includes(socket.id)) {
          io.to(roomId).emit("partnerLeft");
          delete activeChats[roomId];
          io.to("admin_room").emit("chatEnded", roomId);
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
