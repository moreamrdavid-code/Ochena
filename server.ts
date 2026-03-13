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

  // Matching Queue
  let queue: string[] = [];
  // Active Rooms: roomId -> [socketId1, socketId2]
  const rooms = new Map<string, string[]>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Initial stats
    io.emit("stats", { online: io.engine.clientsCount });

    socket.on("join-queue", () => {
      console.log("User joined queue:", socket.id);
      if (queue.includes(socket.id)) return;

      if (queue.length > 0) {
        // Match found!
        const partnerId = queue.shift()!;
        const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        rooms.set(roomId, [socket.id, partnerId]);
        
        socket.join(roomId);
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
          partnerSocket.join(roomId);
          
          // Notify both
          io.to(roomId).emit("matched", { roomId });
          console.log(`Matched ${socket.id} with ${partnerId} in ${roomId}`);
        } else {
          // Partner disconnected while in queue
          queue.push(socket.id);
        }
      } else {
        queue.push(socket.id);
      }
      
      io.emit("stats", { online: io.engine.clientsCount, inQueue: queue.length });
    });

    socket.on("leave-queue", () => {
      queue = queue.filter(id => id !== socket.id);
      io.emit("stats", { online: io.engine.clientsCount, inQueue: queue.length });
    });

    socket.on("send-message", ({ roomId, text }) => {
      const message = {
        id: Math.random().toString(36).substring(7),
        sender: socket.id,
        text,
        timestamp: new Date().toISOString()
      };
      io.to(roomId).emit("receive-message", message);
    });

    socket.on("end-chat", (roomId) => {
      io.to(roomId).emit("chat-ended");
      socket.leave(roomId);
      rooms.delete(roomId);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      queue = queue.filter(id => id !== socket.id);
      
      // Notify partner if in a room
      for (const [roomId, users] of rooms.entries()) {
        if (users.includes(socket.id)) {
          io.to(roomId).emit("chat-ended", { reason: "partner-disconnected" });
          rooms.delete(roomId);
          break;
        }
      }
      
      io.emit("stats", { online: io.engine.clientsCount, inQueue: queue.length });
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
