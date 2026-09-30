const RECIPES = {
    planks: {
        name: "Planks",
        input: {
            wood: 2
        },
        output: {
            planks: 2
        }
    },

    oven: {
        name: "Oven",
        input: {
            iron: 5
        },
        output: {
            oven: 1
        }
    },

    bronzeBar: {
        name: "Bronze Bar",
        input: {
            bronze: 1,
            coal: 1
        },
        output: {
            bronzeBar: 1
        }
    },

    miner: {
        name: "Miner",
        input: {
            bronzeBar: 5
        },
        output: {
            miner: 1
        }
    }
};

module.exports = {
    RECIPES
};