// ------------------------------------------------------------------
// JOVO PROJECT CONFIGURATION
// ------------------------------------------------------------------

module.exports = {
    alexaSkill: {
	nlu: 'alexa',
	manifest: {
	    apis: {
		custom: {
		    interfaces: [
			{
			    type: 'AUDIO_PLAYER',
			},
		    ],
		},
	    },
	},
    },
    googleAction: {
	nlu: 'dialogflow',
	projectId: `new-sounds-on-demand`,
    },

//    endpoint: '${JOVO_WEBHOOK_URL}',
    host: {
    	lambda: {
    	    arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
    	    askProfile: 'admin', // if left out: "default" profile is used
    	}
    }
    
    // TODO: Get this up and running: 
    // In production, the Jovo code will run on an AWS Lambda
    // This is supposed to switch back and forth automagically depending
    // on the stage we are building for. 
    //
    // stages: {
    // 	dev: {
    // 	    endpoint: '${JOVO_WEBHOOK_URL}',
    // 	},
    // 	production: {
    // 	    endpoint: null,
    // 	    host: {
    // 		lambda: {
    // 		    arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
    // 		    askProfile: 'admin', // if left out: "default" profile is used
    // 		}
    // 	    }
    // 	}
    // }
};
