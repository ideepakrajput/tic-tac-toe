const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {}; // Store game rooms

app.use(express.static("public"));

function isEmoji(str) {
    const emojiRegex = /^[\p{Emoji}]$/u;
    return emojiRegex.test(str);
}

function validateSymbol(symbol) {
    if (!symbol) return false;
    symbol = symbol.trim();
    return symbol.length === 1 || isEmoji(symbol);
}

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("joinRoom", (roomId, playerName, playerSymbol) => {
        console.log("Join room attempt:", { roomId, playerName, playerSymbol });

        // Validate input
        if (!playerName || !playerSymbol) {
            socket.emit("invalidJoin", "Name and symbol are required");
            return;
        }

        if (!validateSymbol(playerSymbol)) {
            socket.emit("invalidJoin", "Symbol must be a single letter or emoji");
            return;
        }

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                gameState: ["", "", "", "", "", "", "", "", ""],
                currentPlayer: 0,
                gameActive: true,
                scores: {
                    player1: 0,
                    player2: 0
                }
            };
        }

        const room = rooms[roomId];

        // Check if player name or symbol is already taken in the room
        if (room.players.some(p => p.name === playerName)) {
            socket.emit("invalidJoin", "This name is already taken in this game");
            return;
        }

        if (room.players.some(p => p.symbol === playerSymbol)) {
            socket.emit("invalidJoin", "This symbol is already taken in this game");
            return;
        }

        // Check if the same user is trying to join again
        if (room.players.some(p => p.id === socket.id)) {
            socket.emit("invalidJoin", "You are already in this game");
            return;
        }

        if (room.players.length < 2) {
            const playerId = `player${room.players.length + 1}`;
            room.players.push({
                id: socket.id,
                name: playerName,
                symbol: playerSymbol,
                playerId: playerId
            });
            socket.join(roomId);
            console.log(`Player ${playerName} joined room ${roomId}`);

            // Emit player joined event with player identifier
            socket.emit("playerJoined", { playerId });

            // Emit update with both players and scores
            io.to(roomId).emit("updatePlayers", {
                players: room.players,
                scores: room.scores
            });

            if (room.players.length === 2) {
                io.to(roomId).emit("startGame", room);
            }
        } else {
            socket.emit("roomFull");
        }
    });

    socket.on("makeMove", (roomId, index) => {
        const room = rooms[roomId];
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1 || playerIndex !== room.currentPlayer) return;

        if (room && room.gameState[index] === "" && room.gameActive) {
            const currentPlayer = room.players[room.currentPlayer];
            room.gameState[index] = currentPlayer.symbol;
            room.currentPlayer = room.currentPlayer === 0 ? 1 : 0;
            checkForWinner(roomId);
            io.to(roomId).emit("updateGame", room);
        }
    });

    socket.on("resetGame", (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.gameState = ["", "", "", "", "", "", "", "", ""];
            room.currentPlayer = 0;
            room.gameActive = true;
            io.to(roomId).emit("updateGame", room);
        }
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected:", socket.id);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            
            if (playerIndex !== -1) {
                const disconnectedPlayer = room.players[playerIndex];
                
                // Remove the disconnected player
                room.players.splice(playerIndex, 1);
                
                // Reset the game state if a player leaves
                room.gameState = ["", "", "", "", "", "", "", "", ""];
                room.currentPlayer = 0;
                room.gameActive = true;

                if (room.players.length === 0) {
                    // Delete the room if no players are left
                    delete rooms[roomId];
                } else {
                    // Notify remaining players about the disconnection
                    io.to(roomId).emit("updatePlayers", {
                        players: room.players,
                        scores: room.scores
                    });
                    io.to(roomId).emit("updateGame", room);
                    io.to(roomId).emit("playerDisconnected", {
                        message: `${disconnectedPlayer.name} disconnected. Waiting for new player to join.`
                    });
                }
            }
        }
    });
});

function checkForWinner(roomId) {
    const room = rooms[roomId];
    const winningConditions = [
        [0, 1, 2], // Rows
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6], // Columns
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8], // Diagonals
        [2, 4, 6]
    ];

    // Check for winner
    for (let condition of winningConditions) {
        const [a, b, c] = condition;
        if (
            room.gameState[a] &&
            room.gameState[a] === room.gameState[b] &&
            room.gameState[a] === room.gameState[c]
        ) {
            room.gameActive = false;
            const winner = room.players.find(
                (player) => player.symbol === room.gameState[a]
            );
            
            // Update scores
            if (winner) {
                const scoreKey = winner.playerId; // player1 or player2
                room.scores[scoreKey]++;
            }

            io.to(roomId).emit("gameOver", { winner });
            
            // Send updated scores to all players
            io.to(roomId).emit("updatePlayers", {
                players: room.players,
                scores: room.scores
            });
            return;
        }
    }

    // Check for draw
    if (!room.gameState.includes("")) {
        room.gameActive = false;
        io.to(roomId).emit("gameOver", { winner: null });
    }
}

// Add error handling for the server
server.on('error', (error) => {
    console.error('Server error:', error);
});

// Add error handling for socket.io
io.on('error', (error) => {
    console.error('Socket.io error:', error);
});

// Start the server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});