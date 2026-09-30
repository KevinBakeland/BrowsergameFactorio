const WORLD_WIDTH = 100;
const WORLD_HEIGHT = 100;

const RESOURCE_TYPES = {
    WOOD: "wood",
    COAL: "coal",
    BRONZE: "bronze",
    IRON: "iron",
    WATER: "water"
};


function randomInt(min, max) {

    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


// ============================================================
// GENERATE WORLD
// ============================================================

function generateWorld() {

    const resources = [];

    const occupiedTiles = new Set();

    let resourceId = 0;


    // ========================================================
    // TREES
    // ========================================================

    generateTreeClusters(
        resources,
        10,
        8,
        occupiedTiles,
        () => resourceId++
    );


    // ========================================================
    // COAL
    // ========================================================

    generateOreFields(
        resources,
        RESOURCE_TYPES.COAL,
        5,
        25,
        occupiedTiles,
        () => resourceId++
    );


    // ========================================================
    // BRONZE
    // ========================================================

    generateOreFields(
        resources,
        RESOURCE_TYPES.BRONZE,
        4,
        20,
        occupiedTiles,
        () => resourceId++
    );


    // ========================================================
    // IRON
    // ========================================================

    generateOreFields(
        resources,
        RESOURCE_TYPES.IRON,
        4,
        20,
        occupiedTiles,
        () => resourceId++
    );


    // ========================================================
    // WATER
    // ========================================================

    generateWater(
        resources,
        4,
        () => resourceId++
    );


    return {

        width: WORLD_WIDTH,

        height: WORLD_HEIGHT,

        resources: resources

    };
}


// ============================================================
// TREE CLUSTERS
// ============================================================

function generateTreeClusters(
    resources,
    clusterCount,
    treesPerCluster,
    occupiedTiles,
    getId
) {

    for (
        let cluster = 0;
        cluster < clusterCount;
        cluster++
    ) {


        const centerX =
            randomInt(
                8,
                WORLD_WIDTH - 9
            );


        const centerY =
            randomInt(
                8,
                WORLD_HEIGHT - 9
            );


        let created = 0;

        let attempts = 0;


        while (
            created < treesPerCluster &&
            attempts < treesPerCluster * 20
        ) {

            attempts++;


            const x =
                centerX +
                randomInt(-3, 3);


            const y =
                centerY +
                randomInt(-3, 3);


            if (
                x < 1 ||
                x >= WORLD_WIDTH - 1 ||
                y < 1 ||
                y >= WORLD_HEIGHT - 1
            ) {

                continue;
            }


            const key =
                `${x},${y}`;


            if (
                occupiedTiles.has(key)
            ) {

                continue;
            }


            occupiedTiles.add(key);


            resources.push({

                id: getId(),

                type: RESOURCE_TYPES.WOOD,

                x: x,

                y: y

            });


            created++;

        }

    }

}


// ============================================================
// ORE FIELDS
// ============================================================
//
// Erts wordt in compacte clusters gespawned.
// De posities worden bewust dicht bij het middelpunt
// geplaatst zodat coal, bronze en iron duidelijk
// als één veld bij elkaar staan.
// ============================================================

function generateOreFields(
    resources,
    type,
    fieldCount,
    fieldSize,
    occupiedTiles,
    getId
) {

    for (
        let field = 0;
        field < fieldCount;
        field++
    ) {


        // ====================================================
        // CENTRUM VAN DE CLUSTER
        // ====================================================

        const centerX =
            randomInt(
                10,
                WORLD_WIDTH - 11
            );


        const centerY =
            randomInt(
                10,
                WORLD_HEIGHT - 11
            );


        let created = 0;


        // ====================================================
        // MAAK EEN COMPACTE CLUSTER
        // ====================================================

        //
        // We proberen eerst posities vlak bij het centrum.
        //
        // Bijvoorbeeld:
        //
        //       O O O
        //     O O O O O
        //     O O O O O
        //       O O O
        //
        // Hierdoor lijken de ertsen veel meer op
        // één grote ertsafzetting.
        //

        const positions = [];


        for (
            let radius = 0;
            radius <= 4;
            radius++
        ) {

            for (
                let dx = -radius;
                dx <= radius;
                dx++
            ) {

                for (
                    let dy = -radius;
                    dy <= radius;
                    dy++
                ) {


                    // Afstand tot het centrum
                    const distance =
                        Math.sqrt(
                            dx * dx +
                            dy * dy
                        );


                    // Alleen posities binnen de huidige radius
                    if (
                        distance > radius
                    ) {

                        continue;
                    }


                    positions.push({
                        dx: dx,
                        dy: dy
                    });

                }

            }

        }


        // Posities door elkaar zodat iedere
        // cluster iets anders gevormd wordt
        for (
            let i = positions.length - 1;
            i > 0;
            i--
        ) {

            const j =
                Math.floor(
                    Math.random() * (i + 1)
                );


            const temp =
                positions[i];

            positions[i] =
                positions[j];

            positions[j] =
                temp;
        }


        // ====================================================
        // RESOURCES PLAATSEN
        // ====================================================

        for (
            const position of positions
        ) {

            if (
                created >= fieldSize
            ) {

                break;
            }


            const x =
                centerX +
                position.dx;


            const y =
                centerY +
                position.dy;


            if (
                x < 1 ||
                x >= WORLD_WIDTH - 1 ||
                y < 1 ||
                y >= WORLD_HEIGHT - 1
            ) {

                continue;
            }


            const key =
                `${x},${y}`;


            // Geen overlap met andere resources
            if (
                occupiedTiles.has(key)
            ) {

                continue;
            }


            occupiedTiles.add(key);


            resources.push({

                id: getId(),

                type: type,

                x: x,

                y: y,

                // Iedere erts-klomp begint met 10 voorraad
                amount: 10

            });


            created++;

        }

    }

}


// ============================================================
// WATER
// ============================================================

function generateWater(
    resources,
    lakeCount,
    getId
) {

    for (
        let i = 0;
        i < lakeCount;
        i++
    ) {


        const centerX =
            randomInt(
                10,
                WORLD_WIDTH - 11
            );


        const centerY =
            randomInt(
                10,
                WORLD_HEIGHT - 11
            );


        for (
            let x = -4;
            x <= 4;
            x++
        ) {

            for (
                let y = -3;
                y <= 3;
                y++
            ) {


                if (
                    Math.random() > 0.25
                ) {


                    resources.push({

                        id: getId(),

                        type: RESOURCE_TYPES.WATER,

                        x:
                            centerX + x,

                        y:
                            centerY + y

                    });

                }

            }

        }

    }

}


// ============================================================
// EXPORT
// ============================================================

module.exports = {

    generateWorld,

    RESOURCE_TYPES

};