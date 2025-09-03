const axios = require('axios');

// Vos clés
const runscriptKey = 'VOTRE_CLE';
const runscriptSecret = 'VOTRE_SECRET';

async function testOriginalMethod() {
    try {
        const auth = { 
            username: runscriptKey, 
            password: runscriptSecret 
        };
        
        // Test exact comme dans le code original
        const response = await axios.post(
            'https://runscript.typefi.com/api/v1/job',
            {
                inputs: [],
                outputs: [],
                script: '// test'
            },
            { 
                auth: auth, 
                'Content-Type': 'application/json' 
            }
        );
        
        console.log('✅ Succès:', response.data);
    } catch (error) {
        if (error.response) {
            console.log('❌ Erreur:', error.response.status, error.response.data);
            
            // Si on a une erreur 401, c'est que l'endpoint existe mais auth incorrecte
            // Si on a une erreur 400, c'est que l'endpoint existe mais données incorrectes
            // Si on a une erreur 404/500 avec "Unable to find", l'endpoint n'existe plus
        } else {
            console.log('❌ Erreur réseau:', error.message);
        }
    }
}

testOriginalMethod();