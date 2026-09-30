const socket = io();

const keys = {};

let world = null;
let players = {};
let gameStarted = false;
let inventoryOpen = false;

let buildMode = false;
let selectedMachine = null;
let mouseX = 0;
let mouseY = 0;

const nameScreen =
    document.getElementById("nameScreen");

const nameInput =
    document.getElementById("nameInput");

const startButton =
    document.getElementById("startButton");

const nameError =
    document.getElementById("nameError");

const inventoryButton =
    document.getElementById("inventoryButton");

const inventoryPanel =
    document.getElementById("inventoryPanel");

const closeInventory =
    document.getElementById("closeInventory");

const buildModeElement =
    document.getElementById("buildMode");

const buildModeText =
    document.getElementById("buildModeText");

const craftMessage =
    document.getElementById("craftMessage");

const canvas =
    document.getElementById("gameCanvas");

const ctx =
    canvas.getContext("2d");

function resizeCanvas() {
    canvas.width =
        window.innerWidth;

    canvas.height =
        window.innerHeight;
}

window.addEventListener(
    "resize",
    resizeCanvas
);

resizeCanvas();

const player = {
    x: 2500,
    y: 2500,
    size: 20,
    speed: 5
};

let inventory = {
    wood: 0,
    planks: 0,
    coal: 0,
    bronze: 0,
    iron: 0,
    bronzeBar: 0,
    oven: 0,
    miner: 0
};

const camera = {
    x: 0,
    y: 0
};

function startGame() {

    const name =
        nameInput.value.trim();

    if (name.length === 0) {
        nameError.textContent =
            "Please enter a name.";

        return;
    }

    if (name.length > 16) {
        nameError.textContent =
            "Name can be maximum 16 characters.";

        return;
    }

    nameError.textContent = "";

    socket.emit(
        "joinGame",
        name
    );
}

startButton.addEventListener(
    "click",
    startGame
);

nameInput.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Enter"
        ) {
            startGame();
        }
    }
);

socket.on(
    "gameStarted",
    () => {

        gameStarted =
            true;

        nameScreen.style.display =
            "none";

        canvas.style.display =
            "block";
    }
);

socket.on(
    "worldData",
    (receivedWorld) => {

        world =
            receivedWorld;

        if (!world.drops) {
            world.drops = [];
        }

        if (!world.machines) {
            world.machines = [];
        }
    }
);

socket.on(
    "playersData",
    (receivedPlayers) => {

        players =
            receivedPlayers;

        const ownPlayer =
            players[socket.id];

        if (!ownPlayer) {
            return;
        }

        player.x =
            ownPlayer.x;

        player.y =
            ownPlayer.y;

        if (
            ownPlayer.inventory
        ) {
            inventory =
                ownPlayer.inventory;
        }

        updateInventoryUI();
    }
);

function openInventory() {

    if (!gameStarted) {
        return;
    }

    inventoryOpen =
        true;

    inventoryPanel.style.display =
        "block";

    updateInventoryUI();
}

function closeInventoryPanel() {

    inventoryOpen =
        false;

    inventoryPanel.style.display =
        "none";
}

inventoryButton.addEventListener(
    "click",
    () => {

        if (inventoryOpen) {
            closeInventoryPanel();
        } else {
            openInventory();
        }
    }
);

closeInventory.addEventListener(
    "click",
    closeInventoryPanel
);

window.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key.toLowerCase() !== "i"
        ) {
            return;
        }

        if (!gameStarted) {
            return;
        }

        if (inventoryOpen) {
            closeInventoryPanel();
        } else {
            openInventory();
        }
    }
);

const dropButtons =
    document.querySelectorAll(
        ".dropButton"
    );

dropButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const itemType =
                    button.dataset.item;

                const input =
                    document.getElementById(
                        `${itemType}DropAmount`
                    );

                const amount =
                    Number(input.value);

                if (
                    !Number.isInteger(amount) ||
                    amount <= 0
                ) {
                    return;
                }

                socket.emit(
                    "dropItem",
                    {
                        itemType:
                            itemType,

                        amount:
                            amount
                    }
                );

                input.value = "";
            }
        );
    }
);

const craftButtons =
    document.querySelectorAll(
        ".craftButton"
    );

craftButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const recipe =
                    button.dataset.recipe;

                socket.emit(
                    "craftItem",
                    recipe
                );

                craftMessage.textContent =
                    "Crafting...";
            }
        );
    }
);

const buildButtons =
    document.querySelectorAll(
        ".buildButton"
    );

buildButtons.forEach(
    (button) => {

        button.addEventListener(
            "click",
            () => {

                const machine =
                    button.dataset.machine;

                startBuildMode(
                    machine
                );
            }
        );
    }
);

function updateInventoryUI() {

    document.getElementById(
        "woodAmount"
    ).textContent =
        inventory.wood || 0;

    document.getElementById(
        "planksAmount"
    ).textContent =
        inventory.planks || 0;

    document.getElementById(
        "coalAmount"
    ).textContent =
        inventory.coal || 0;

    document.getElementById(
        "bronzeAmount"
    ).textContent =
        inventory.bronze || 0;

    document.getElementById(
        "ironAmount"
    ).textContent =
        inventory.iron || 0;

    document.getElementById(
        "bronzeBarAmount"
    ).textContent =
        inventory.bronzeBar || 0;

    document.getElementById(
        "ovenAmount"
    ).textContent =
        inventory.oven || 0;

    document.getElementById(
        "minerAmount"
    ).textContent =
        inventory.miner || 0;
}

function startBuildMode(machineType) {

    if (
        !inventory[machineType] ||
        inventory[machineType] <= 0
    ) {
        craftMessage.textContent =
            `You don't have a ${machineType}.`;

        return;
    }

    buildMode =
        true;

    selectedMachine =
        machineType;

    inventoryOpen =
        false;

    inventoryPanel.style.display =
        "none";

    buildModeElement.style.display =
        "block";

    buildModeText.textContent =
        `Placing ${machineType} - click to place, ESC to cancel`;
}

function cancelBuildMode() {

    buildMode =
        false;

    selectedMachine =
        null;

    buildModeElement.style.display =
        "none";
}

canvas.addEventListener(
    "mousemove",
    (event) => {

        mouseX =
            event.clientX;

        mouseY =
            event.clientY;
    }
);

canvas.addEventListener(
    "click",
    () => {

        if (!buildMode) {
            return;
        }

        placeSelectedMachine();
    }
);

window.addEventListener(
    "keydown",
    (event) => {

        if (
            event.key === "Escape"
        ) {
            cancelBuildMode();
        }
    }
);

function getBuildWorldPosition() {

    const worldX =
        mouseX +
        camera.x;

    const worldY =
        mouseY +
        camera.y;

    const tileSize =
        50;

    return {
        x:
            Math.floor(
                worldX / tileSize
            ) * tileSize,

        y:
            Math.floor(
                worldY / tileSize
            ) * tileSize
    };
}

function placeSelectedMachine() {

    if (!selectedMachine) {
        return;
    }

    const position =
        getBuildWorldPosition();

    socket.emit(
        "placeMachine",
        {
            type:
                selectedMachine,

            x:
                position.x,

            y:
                position.y
        }
    );

    cancelBuildMode();
}

window.addEventListener(
    "keydown",
    (event) => {

        if (!gameStarted) {
            return;
        }

        if (
            event.target.tagName === "INPUT"
        ) {
            return;
        }

        const key =
            event.key.toLowerCase();

        keys[key] =
            true;

        if (
            key === "e"
        ) {
            tryInteract();
        }
    }
);

window.addEventListener(
    "keyup",
    (event) => {

        const key =
            event.key.toLowerCase();

        keys[key] =
            false;
    }
);

function tryInteract() {

    if (!world) {
        return;
    }

    if (buildMode) {
        return;
    }

    const machine =
        findClosestMachine();

    if (machine) {

        const machineCenterX =
            machine.x +
            machine.width * 50 / 2;

        const machineCenterY =
            machine.y +
            machine.height * 50 / 2;

        const distance =
            Math.sqrt(
                Math.pow(
                    player.x -
                    machineCenterX,
                    2
                ) +
                Math.pow(
                    player.y -
                    machineCenterY,
                    2
                )
            );

        if (distance <= 125) {

            if (
                machine.type === "oven"
            ) {

                socket.emit(
                    "interactMachine",
                    machine.id
                );

                return;
            }
        }
    }

    const pickedUp =
        tryPickupDrop();

    if (pickedUp) {
        return;
    }

    tryMine();
}

function findClosestMachine() {

    if (
        !world ||
        !world.machines
    ) {
        return null;
    }

    let closestMachine =
        null;

    let closestDistance =
        Infinity;

    for (
        const machine
        of world.machines
    ) {

        const centerX =
            machine.x +
            machine.width * 50 / 2;

        const centerY =
            machine.y +
            machine.height * 50 / 2;

        const distance =
            Math.sqrt(
                Math.pow(
                    player.x -
                    centerX,
                    2
                ) +
                Math.pow(
                    player.y -
                    centerY,
                    2
                )
            );

        if (
            distance <
            closestDistance
        ) {

            closestDistance =
                distance;

            closestMachine =
                machine;
        }
    }

    return closestMachine;
}

function tryPickupDrop() {

    if (
        !world ||
        !world.drops
    ) {
        return false;
    }

    let closestDrop =
        null;

    let closestDistance =
        Infinity;

    for (
        const drop
        of world.drops
    ) {

        const distance =
            Math.sqrt(
                Math.pow(
                    player.x - drop.x,
                    2
                ) +
                Math.pow(
                    player.y - drop.y,
                    2
                )
            );

        if (
            distance <
            closestDistance
        ) {

            closestDistance =
                distance;

            closestDrop =
                drop;
        }
    }

    if (!closestDrop) {
        return false;
    }

    if (
        closestDistance > 75
    ) {
        return false;
    }

    socket.emit(
        "pickupDrop",
        closestDrop.id
    );

    return true;
}

function tryMine() {

    if (!world) {
        return;
    }

    let closestResource =
        null;

    let closestDistance =
        Infinity;

    for (
        const resource
        of world.resources
    ) {

        if (
            resource.type === "water"
        ) {
            continue;
        }

        const resourceX =
            resource.x * 50 + 25;

        const resourceY =
            resource.y * 50 + 25;

        const distance =
            Math.sqrt(
                Math.pow(
                    player.x - resourceX,
                    2
                ) +
                Math.pow(
                    player.y - resourceY,
                    2
                )
            );

        if (
            distance <
            closestDistance
        ) {

            closestDistance =
                distance;

            closestResource =
                resource;
        }
    }

    if (!closestResource) {
        return;
    }

    if (
        closestDistance > 75
    ) {
        return;
    }

    socket.emit(
        "mineResource",
        closestResource.id
    );
}

function updatePlayer() {

    if (!gameStarted) {
        return;
    }

    if (inventoryOpen) {
        return;
    }

    if (buildMode) {
        return;
    }

    let moved =
        false;

    if (keys["w"]) {
        player.y -= player.speed;
        moved = true;
    }

    if (keys["s"]) {
        player.y += player.speed;
        moved = true;
    }

    if (keys["a"]) {
        player.x -= player.speed;
        moved = true;
    }

    if (keys["d"]) {
        player.x += player.speed;
        moved = true;
    }

    const worldWidth =
        100 * 50;

    const worldHeight =
        100 * 50;

    if (
        player.x <
        player.size
    ) {
        player.x =
            player.size;
    }

    if (
        player.x >
        worldWidth -
        player.size
    ) {
        player.x =
            worldWidth -
            player.size;
    }

    if (
        player.y <
        player.size
    ) {
        player.y =
            player.size;
    }

    if (
        player.y >
        worldHeight -
        player.size
    ) {
        player.y =
            worldHeight -
            player.size;
    }

    if (moved) {

        socket.emit(
            "playerMove",
            {
                x:
                    player.x,

                y:
                    player.y
            }
        );
    }

    camera.x =
        player.x -
        canvas.width / 2;

    camera.y =
        player.y -
        canvas.height / 2;
}

function drawWorld() {

    ctx.fillStyle =
        "#3f6b3f";

    ctx.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    const tileSize =
        50;

    ctx.strokeStyle =
        "#4f7a4f";

    ctx.lineWidth =
        1;

    for (
        let x = 0;
        x < 100;
        x++
    ) {

        for (
            let y = 0;
            y < 100;
            y++
        ) {

            const screenX =
                x * tileSize -
                camera.x;

            const screenY =
                y * tileSize -
                camera.y;

            ctx.strokeRect(
                screenX,
                screenY,
                tileSize,
                tileSize
            );
        }
    }

    if (!world) {
        return;
    }

    drawMachines();

    for (
        const resource
        of world.resources
    ) {

        const screenX =
            resource.x *
            tileSize -
            camera.x;

        const screenY =
            resource.y *
            tileSize -
            camera.y;

        drawResource(
            resource,
            screenX,
            screenY,
            tileSize
        );
    }

    drawDroppedItems();

    if (buildMode) {
        drawBuildPreview();
    }
}

function drawResource(
    resource,
    x,
    y,
    size
) {

    const centerX =
        x + size / 2;

    const centerY =
        y + size / 2;

    if (
        resource.type === "wood"
    ) {

        ctx.fillStyle =
            "#6b3e26";

        ctx.fillRect(
            centerX - 5,
            centerY,
            10,
            20
        );

        ctx.fillStyle =
            "#236b2d";

        ctx.beginPath();

        ctx.arc(
            centerX,
            centerY - 5,
            18,
            0,
            Math.PI * 2
        );

        ctx.fill();

        return;
    }

    if (
        resource.type === "coal"
    ) {

        ctx.fillStyle =
            "#222";

        ctx.beginPath();

        ctx.arc(
            centerX,
            centerY,
            15,
            0,
            Math.PI * 2
        );

        ctx.fill();

        drawResourceAmount(
            resource,
            centerX,
            centerY
        );

        return;
    }

    if (
        resource.type === "bronze"
    ) {

        ctx.fillStyle =
            "#b87333";

        ctx.beginPath();

        ctx.arc(
            centerX,
            centerY,
            15,
            0,
            Math.PI * 2
        );

        ctx.fill();

        drawResourceAmount(
            resource,
            centerX,
            centerY
        );

        return;
    }

    if (
        resource.type === "iron"
    ) {

        ctx.fillStyle =
            "#888";

        ctx.beginPath();

        ctx.arc(
            centerX,
            centerY,
            15,
            0,
            Math.PI * 2
        );

        ctx.fill();

        drawResourceAmount(
            resource,
            centerX,
            centerY
        );

        return;
    }

    if (
        resource.type === "water"
    ) {

        ctx.fillStyle =
            "#3498db";

        ctx.fillRect(
            x,
            y,
            size,
            size
        );
    }
}

function drawResourceAmount(
    resource,
    centerX,
    centerY
) {

    if (
        resource.amount === undefined
    ) {
        return;
    }

    ctx.fillStyle =
        "#ffffff";

    ctx.font =
        "bold 12px Arial";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "middle";

    ctx.fillText(
        resource.amount,
        centerX,
        centerY
    );

    ctx.textAlign =
        "left";

    ctx.textBaseline =
        "alphabetic";
}

function drawMachines() {

    if (
        !world ||
        !world.machines
    ) {
        return;
    }

    for (
        const machine
        of world.machines
    ) {

        const screenX =
            machine.x -
            camera.x;

        const screenY =
            machine.y -
            camera.y;

        const width =
            machine.width * 50;

        const height =
            machine.height * 50;

        if (
            machine.type === "oven"
        ) {

            ctx.fillStyle =
                "#555";

            ctx.fillRect(
                screenX,
                screenY,
                width,
                height
            );

            ctx.strokeStyle =
                "#222";

            ctx.lineWidth =
                4;

            ctx.strokeRect(
                screenX,
                screenY,
                width,
                height
            );

            ctx.fillStyle =
                "#e67e22";

            ctx.beginPath();

            ctx.arc(
                screenX + width / 2,
                screenY + height / 2,
                18,
                0,
                Math.PI * 2
            );

            ctx.fill();

            ctx.fillStyle =
                "#ffffff";

            ctx.font =
                "bold 13px Arial";

            ctx.textAlign =
                "center";

            ctx.fillText(
                "OVEN",
                screenX + width / 2,
                screenY + height - 8
            );

            ctx.textAlign =
                "left";
        }

        if (
            machine.type === "miner"
        ) {

            ctx.fillStyle =
                "#6d6d6d";

            ctx.fillRect(
                screenX,
                screenY,
                width,
                height
            );

            ctx.strokeStyle =
                "#222";

            ctx.lineWidth =
                5;

            ctx.strokeRect(
                screenX,
                screenY,
                width,
                height
            );

            ctx.fillStyle =
                "#aaaaaa";

            ctx.beginPath();

            ctx.arc(
                screenX + width / 2,
                screenY + height / 2,
                35,
                0,
                Math.PI * 2
            );

            ctx.fill();

            ctx.fillStyle =
                "#333";

            ctx.fillRect(
                screenX + width / 2 - 8,
                screenY + 15,
                16,
                height - 30
            );

            ctx.fillStyle =
                "#ffffff";

            ctx.font =
                "bold 14px Arial";

            ctx.textAlign =
                "center";

            ctx.fillText(
                "MINER",
                screenX + width / 2,
                screenY + height - 10
            );

            ctx.textAlign =
                "left";
        }
    }
}

function drawBuildPreview() {

    if (!selectedMachine) {
        return;
    }

    const position =
        getBuildWorldPosition();

    let width = 2;
    let height = 2;

    if (
        selectedMachine === "miner"
    ) {
        width = 4;
        height = 4;
    }

    const screenX =
        position.x -
        camera.x;

    const screenY =
        position.y -
        camera.y;

    ctx.fillStyle =
        "rgba(255, 255, 255, 0.25)";

    ctx.fillRect(
        screenX,
        screenY,
        width * 50,
        height * 50
    );

    ctx.strokeStyle =
        "#ffffff";

    ctx.lineWidth =
        2;

    ctx.strokeRect(
        screenX,
        screenY,
        width * 50,
        height * 50
    );
}

function drawDroppedItems() {

    if (
        !world ||
        !world.drops
    ) {
        return;
    }

    const now =
        Date.now();

    for (
        const drop
        of world.drops
    ) {

        const age =
            now -
            drop.createdAt;

        let visible =
            true;

        if (
            age >= 60000
        ) {

            visible =
                Math.floor(
                    age / 250
                ) % 2 === 0;
        }

        if (!visible) {
            continue;
        }

        const screenX =
            drop.x -
            camera.x;

        const screenY =
            drop.y -
            camera.y;

        ctx.fillStyle =
            "#222";

        ctx.beginPath();

        ctx.arc(
            screenX,
            screenY,
            16,
            0,
            Math.PI * 2
        );

        ctx.fill();

        ctx.strokeStyle =
            "#ffffff";

        ctx.lineWidth =
            2;

        ctx.stroke();

        let icon =
            "?";

        if (
            drop.type === "wood"
        ) icon = "🌲";

        if (
            drop.type === "planks"
        ) icon = "📦";

        if (
            drop.type === "coal"
        ) icon = "⬛";

        if (
            drop.type === "bronze"
        ) icon = "🟠";

        if (
            drop.type === "iron"
        ) icon = "⚙";

        if (
            drop.type === "bronzeBar"
        ) icon = "🔩";

        if (
            drop.type === "oven"
        ) icon = "🔥";

        if (
            drop.type === "miner"
        ) icon = "⛏️";

        ctx.font =
            "16px Arial";

        ctx.textAlign =
            "center";

        ctx.textBaseline =
            "middle";

        ctx.fillStyle =
            "#ffffff";

        ctx.fillText(
            icon,
            screenX,
            screenY
        );

        ctx.font =
            "bold 13px Arial";

        ctx.fillText(
            drop.amount,
            screenX,
            screenY + 28
        );

        ctx.textAlign =
            "left";

        ctx.textBaseline =
            "alphabetic";
    }
}

function drawOtherPlayers() {

    for (
        const id in players
    ) {

        if (
            id === socket.id
        ) {
            continue;
        }

        const otherPlayer =
            players[id];

        const screenX =
            otherPlayer.x -
            camera.x;

        const screenY =
            otherPlayer.y -
            camera.y;

        ctx.fillStyle =
            "#e74c3c";

        ctx.beginPath();

        ctx.arc(
            screenX,
            screenY,
            20,
            0,
            Math.PI * 2
        );

        ctx.fill();

        drawPlayerName(
            otherPlayer.name,
            screenX,
            screenY
        );
    }
}

function drawPlayer() {

    ctx.fillStyle =
        "#3498db";

    ctx.beginPath();

    ctx.arc(
        canvas.width / 2,
        canvas.height / 2,
        player.size,
        0,
        Math.PI * 2
    );

    ctx.fill();

    const ownPlayer =
        players[socket.id];

    if (
        ownPlayer &&
        ownPlayer.name
    ) {

        drawPlayerName(
            ownPlayer.name,
            canvas.width / 2,
            canvas.height / 2
        );
    }
}

function drawPlayerName(
    name,
    x,
    y
) {

    if (!name) {
        return;
    }

    ctx.font =
        "bold 14px Arial";

    ctx.textAlign =
        "center";

    ctx.textBaseline =
        "bottom";

    const textWidth =
        ctx.measureText(
            name
        ).width;

    ctx.fillStyle =
        "rgba(0, 0, 0, 0.6)";

    ctx.fillRect(
        x -
        textWidth / 2 -
        5,

        y -
        35,

        textWidth +
        10,

        20
    );

    ctx.fillStyle =
        "#ffffff";

    ctx.fillText(
        name,
        x,
        y - 18
    );

    ctx.textAlign =
        "left";

    ctx.textBaseline =
        "alphabetic";
}

function gameLoop() {

    if (gameStarted) {

        updatePlayer();

        drawWorld();

        drawOtherPlayers();

        drawPlayer();
    }

    requestAnimationFrame(
        gameLoop
    );
}

gameLoop();