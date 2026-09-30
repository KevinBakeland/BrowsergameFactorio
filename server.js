const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const { generateWorld } = require("./server/world");
const { RECIPES } = require("./server/recipes");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

const world = generateWorld();

world.drops = [];
world.machines = [];

let nextDropId = 1;
let nextMachineId = 1;

console.log(
    `Wereld gegenereerd: ${world.width}x${world.height}`
);

console.log(
    `Aantal resources: ${world.resources.length}`
);

app.use(express.static("client"));

const players = {};

const spawnPoints = [
    { x: 1000, y: 1000 },
    { x: 4000, y: 1000 },
    { x: 1000, y: 4000 },
    { x: 4000, y: 4000 }
];

const validItems = [
    "wood",
    "planks",
    "coal",
    "bronze",
    "iron",
    "bronzeBar",
    "oven",
    "miner"
];

const machineSizes = {
    oven: {
        width: 2,
        height: 2
    },

    miner: {
        width: 4,
        height: 4
    }
};

function broadcastWorld() {
    io.emit("worldData", world);
}

function broadcastPlayers() {
    io.emit("playersData", players);
}

function distanceBetween(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    return Math.sqrt(
        dx * dx +
        dy * dy
    );
}

function playerHasItems(player, items) {
    for (const item in items) {
        if (
            !player.inventory[item] ||
            player.inventory[item] < items[item]
        ) {
            return false;
        }
    }

    return true;
}

function removeItems(player, items) {
    for (const item in items) {
        player.inventory[item] -= items[item];
    }
}

function addItems(player, items) {
    for (const item in items) {
        if (
            player.inventory[item] === undefined
        ) {
            player.inventory[item] = 0;
        }

        player.inventory[item] += items[item];
    }
}

function canPlaceMachine(x, y, width, height) {

    const worldWidth = world.width * 50;
    const worldHeight = world.height * 50;

    if (x < 0 || y < 0) {
        return false;
    }

    if (
        x + width * 50 >
        worldWidth
    ) {
        return false;
    }

    if (
        y + height * 50 >
        worldHeight
    ) {
        return false;
    }

    for (
        const machine
        of world.machines
    ) {

        const machineWidth =
            machine.width * 50;

        const machineHeight =
            machine.height * 50;

        const overlap =
            x < machine.x + machineWidth &&
            x + width * 50 > machine.x &&
            y < machine.y + machineHeight &&
            y + height * 50 > machine.y;

        if (overlap) {
            return false;
        }
    }

    return true;
}

function getResourcesUnderMachine(machine) {

    const resources = [];

    const tileSize = 50;

    const startX =
        Math.floor(machine.x / tileSize);

    const startY =
        Math.floor(machine.y / tileSize);

    const endX =
        startX + machine.width;

    const endY =
        startY + machine.height;

    for (
        const resource
        of world.resources
    ) {

        if (
            resource.type === "water"
        ) {
            continue;
        }

        if (
            resource.x >= startX &&
            resource.x < endX &&
            resource.y >= startY &&
            resource.y < endY
        ) {
            resources.push(resource);
        }
    }

    return resources;
}

function runMiner(machine) {

    if (
        machine.type !== "miner"
    ) {
        return;
    }

    const resources =
        getResourcesUnderMachine(machine);

    if (resources.length === 0) {
        return;
    }

    // Find the first resource that still has something to mine.
    const resource =
        resources.find(
            currentResource => {

                if (
                    currentResource.type === "wood"
                ) {
                    return true;
                }

                if (
                    currentResource.type === "coal" ||
                    currentResource.type === "bronze" ||
                    currentResource.type === "iron"
                ) {
                    return currentResource.amount > 0;
                }

                return false;
            }
        );

    if (!resource) {
        return;
    }

    if (
        resource.type === "wood"
    ) {

        const resourceIndex =
            world.resources.findIndex(
                currentResource =>
                    currentResource.id ===
                    resource.id
            );

        if (
            resourceIndex === -1
        ) {
            return;
        }

        world.resources.splice(
            resourceIndex,
            1
        );

        machine.totalMined++;

        // Find the owner of the machine.
        const owner =
            players[machine.ownerId];

        if (owner) {
            owner.inventory.wood++;
            broadcastPlayers();
        }

        broadcastWorld();

        console.log(
            `Miner ${machine.id} chopped down tree ${resource.id}`
        );

        return;
    }

    if (
        resource.type === "coal" ||
        resource.type === "bronze" ||
        resource.type === "iron"
    ) {

        if (
            resource.amount <= 0
        ) {
            return;
        }

        resource.amount--;

        machine.totalMined++;

        const owner =
            players[machine.ownerId];

        if (owner) {
            owner.inventory[
                resource.type
            ]++;

            broadcastPlayers();
        }

        if (
            resource.amount <= 0
        ) {

            const resourceIndex =
                world.resources.findIndex(
                    currentResource =>
                        currentResource.id ===
                        resource.id
                );

            if (
                resourceIndex !== -1
            ) {
                world.resources.splice(
                    resourceIndex,
                    1
                );
            }
        }

        broadcastWorld();

        console.log(
            `Miner ${machine.id} mined 1 ${resource.type}`
        );
    }
}

function startMiner(machine) {

    machine.interval =
        setInterval(
            () => {
                runMiner(machine);
            },
            1000
        );
}

io.on("connection", (socket) => {

    console.log(
        "Speler verbonden:",
        socket.id
    );

    socket.on("joinGame", (playerName) => {

        if (!playerName) {
            return;
        }

        let name =
            String(playerName)
                .trim()
                .substring(0, 16);

        if (name.length === 0) {
            return;
        }

        const spawnPoint =
            spawnPoints[
                Object.keys(players).length %
                spawnPoints.length
            ];

        players[socket.id] = {
            id: socket.id,

            name: name,

            x: spawnPoint.x,

            y: spawnPoint.y,

            inventory: {
                wood: 0,
                planks: 0,
                coal: 0,
                bronze: 0,
                iron: 0,
                bronzeBar: 0,
                oven: 0,
                miner: 0
            }
        };

        console.log(
            `${name} joined the game (${socket.id})`
        );

        socket.emit(
            "worldData",
            world
        );

        broadcastPlayers();

        socket.emit(
            "gameStarted"
        );
    });

    socket.on(
        "playerMove",
        (position) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            player.x = position.x;
            player.y = position.y;

            broadcastPlayers();
        }
    );

    socket.on(
        "mineResource",
        (resourceId) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            const resourceIndex =
                world.resources.findIndex(
                    resource =>
                        resource.id === resourceId
                );

            if (resourceIndex === -1) {
                return;
            }

            const resource =
                world.resources[
                    resourceIndex
                ];

            if (
                resource.type === "water"
            ) {
                return;
            }

            const resourceX =
                resource.x * 50 + 25;

            const resourceY =
                resource.y * 50 + 25;

            const distance =
                distanceBetween(
                    player.x,
                    player.y,
                    resourceX,
                    resourceY
                );

            const miningDistance = 75;

            if (
                distance >
                miningDistance
            ) {
                return;
            }

            if (
                resource.type === "wood"
            ) {

                world.resources.splice(
                    resourceIndex,
                    1
                );

                player.inventory.wood++;

                broadcastWorld();
                broadcastPlayers();

                return;
            }

            if (
                resource.type === "coal" ||
                resource.type === "bronze" ||
                resource.type === "iron"
            ) {

                if (
                    resource.amount <= 0
                ) {
                    return;
                }

                resource.amount--;

                player.inventory[
                    resource.type
                ]++;

                if (
                    resource.amount <= 0
                ) {

                    world.resources.splice(
                        resourceIndex,
                        1
                    );
                }

                broadcastWorld();
                broadcastPlayers();
            }
        }
    );

    socket.on(
        "craftItem",
        (recipeId) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            const recipe =
                RECIPES[recipeId];

            if (!recipe) {
                return;
            }

            if (
                !playerHasItems(
                    player,
                    recipe.input
                )
            ) {
                return;
            }

            removeItems(
                player,
                recipe.input
            );

            addItems(
                player,
                recipe.output
            );

            console.log(
                `${player.name} crafted ${recipe.name}`
            );

            broadcastPlayers();
        }
    );

    socket.on(
        "interactOven",
        (machineId) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            const oven =
                world.machines.find(
                    machine =>
                        machine.id ===
                        machineId
                );

            if (
                !oven ||
                oven.type !== "oven"
            ) {
                return;
            }

            const ovenCenterX =
                oven.x +
                oven.width * 50 / 2;

            const ovenCenterY =
                oven.y +
                oven.height * 50 / 2;

            const distance =
                distanceBetween(
                    player.x,
                    player.y,
                    ovenCenterX,
                    ovenCenterY
                );

            if (
                distance > 100
            ) {
                return;
            }

            const recipe =
                RECIPES.bronzeBar;

            if (
                !playerHasItems(
                    player,
                    recipe.input
                )
            ) {
                return;
            }

            removeItems(
                player,
                recipe.input
            );

            addItems(
                player,
                recipe.output
            );

            console.log(
                `${player.name} smelted 1 bronze bar`
            );

            broadcastPlayers();
        }
    );

    socket.on(
        "placeMachine",
        (data) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            if (
                !data ||
                !data.type
            ) {
                return;
            }

            const machineType =
                data.type;

            if (
                machineType !== "oven" &&
                machineType !== "miner"
            ) {
                return;
            }

            const size =
                machineSizes[
                    machineType
                ];

            if (!size) {
                return;
            }

            if (
                !player.inventory[
                    machineType
                ] ||
                player.inventory[
                    machineType
                ] <= 0
            ) {
                return;
            }

            let x =
                Number(data.x);

            let y =
                Number(data.y);

            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y)
            ) {
                return;
            }

            const tileSize = 50;

            // Snap machine to the tile grid.
            x =
                Math.floor(
                    x / tileSize
                ) * tileSize;

            y =
                Math.floor(
                    y / tileSize
                ) * tileSize;

            const centerX =
                x +
                size.width * tileSize / 2;

            const centerY =
                y +
                size.height * tileSize / 2;

            if (
                distanceBetween(
                    player.x,
                    player.y,
                    centerX,
                    centerY
                ) > 200
            ) {
                return;
            }

            if (
                !canPlaceMachine(
                    x,
                    y,
                    size.width,
                    size.height
                )
            ) {
                return;
            }

            player.inventory[
                machineType
            ]--;

            const machine = {
                id:
                    `machine-${nextMachineId++}`,

                type:
                    machineType,

                x:
                    x,

                y:
                    y,

                width:
                    size.width,

                height:
                    size.height,

                ownerId:
                    socket.id,

                totalMined:
                    0
            };

            world.machines.push(
                machine
            );

            console.log(
                `${player.name} placed ${machineType}`
            );

            if (
                machineType === "miner"
            ) {
                startMiner(machine);
            }

            broadcastWorld();
            broadcastPlayers();
        }
    );

    socket.on(
        "dropItem",
        (data) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            let itemType;
            let amount;

            if (
                data &&
                typeof data === "object"
            ) {
                itemType =
                    data.itemType;

                amount =
                    Number(data.amount);
            } else {
                itemType =
                    data;

                amount =
                    1;
            }

            if (
                !validItems.includes(
                    itemType
                )
            ) {
                return;
            }

            if (
                !Number.isInteger(amount)
            ) {
                return;
            }

            if (
                amount <= 0
            ) {
                return;
            }

            if (
                player.inventory[itemType] <
                amount
            ) {
                return;
            }

            player.inventory[itemType] -=
                amount;

            const drop = {
                id:
                    `drop-${nextDropId++}`,

                type:
                    itemType,

                amount:
                    amount,

                x:
                    player.x,

                y:
                    player.y,

                createdAt:
                    Date.now()
            };

            world.drops.push(
                drop
            );

            broadcastWorld();
            broadcastPlayers();

            setTimeout(
                () => {

                    const dropIndex =
                        world.drops.findIndex(
                            currentDrop =>
                                currentDrop.id ===
                                drop.id
                        );

                    if (
                        dropIndex === -1
                    ) {
                        return;
                    }

                    world.drops.splice(
                        dropIndex,
                        1
                    );

                    broadcastWorld();

                },
                70000
            );
        }
    );

    socket.on(
        "pickupDrop",
        (dropId) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            const dropIndex =
                world.drops.findIndex(
                    drop =>
                        drop.id === dropId
                );

            if (
                dropIndex === -1
            ) {
                return;
            }

            const drop =
                world.drops[
                    dropIndex
                ];

            const distance =
                distanceBetween(
                    player.x,
                    player.y,
                    drop.x,
                    drop.y
                );

            if (
                distance > 75
            ) {
                return;
            }

            if (
                !validItems.includes(
                    drop.type
                )
            ) {
                return;
            }

            if (
                !Number.isInteger(
                    drop.amount
                ) ||
                drop.amount <= 0
            ) {
                return;
            }

            addItems(
                player,
                {
                    [drop.type]:
                        drop.amount
                }
            );

            world.drops.splice(
                dropIndex,
                1
            );

            broadcastWorld();
            broadcastPlayers();
        }
    );

    socket.on(
        "interactMachine",
        (machineId) => {

            const player =
                players[socket.id];

            if (!player) {
                return;
            }

            const machine =
                world.machines.find(
                    currentMachine =>
                        currentMachine.id ===
                        machineId
                );

            if (!machine) {
                return;
            }

            const centerX =
                machine.x +
                machine.width * 50 / 2;

            const centerY =
                machine.y +
                machine.height * 50 / 2;

            const distance =
                distanceBetween(
                    player.x,
                    player.y,
                    centerX,
                    centerY
                );

            if (
                distance > 125
            ) {
                return;
            }

            if (
                machine.type === "oven"
            ) {

                const recipe =
                    RECIPES.bronzeBar;

                if (
                    !playerHasItems(
                        player,
                        recipe.input
                    )
                ) {
                    return;
                }

                removeItems(
                    player,
                    recipe.input
                );

                addItems(
                    player,
                    recipe.output
                );

                console.log(
                    `${player.name} used oven ${machine.id}`
                );

                broadcastPlayers();
            }
        }
    );

    socket.on(
        "disconnect",
        () => {

            if (
                players[socket.id]
            ) {
                console.log(
                    `${players[socket.id].name} left the game`
                );
            }

            delete players[
                socket.id
            ];

            broadcastPlayers();
        }
    );
});

server.listen(
    PORT,
    () => {

        console.log(
            `Factory Game server draait op http://localhost:${PORT}`
        );
    }
);