// ------------------------------------------------------------------
// JOVO PROJECT CONFIGURATION
// ------------------------------------------------------------------

module.exports = {
    stages: {
	local: {
	    endpoint: '${JOVO_WEBHOOK_URL}'
	},
	lambda: {
  	    arn: 'arn:aws:lambda:us-east-1:046935287063:function:dev-new-sounds-on-demand',
 	    askProfile: 'admin', // if left out: "default" profile is used
	    endpoint: 'arn:aws:lambda:us-east-1:046935287063:function:dev-new-sounds-on-demand'
	}
    },
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

    // MANUAL DEV/PROD SWITCHING: Comment out either endpoint: or host:.
    //     host: {
    // 	lambda: {
    // 	    arn: 'arn:aws:lambda:us-east-1:046935287063:function:dev-new-sounds-on-demand',
    // 	    askProfile: 'admin', // if left out: "default" profile is used
    // 	}
    // }
    
    // TODO: Get this up and running: 
    // In production, the Jovo code will run on an AWS Lambda
    // This is supposed to replace the manual kluge above and 
    // switch back and forth automagically depending on the stage 
    // we are building for.
    // https://v3.jovo.tech/tutorials/staging-examples
    //
    // stages: {
    // 	dev: {
    // 	    endpoint: '${JOVO_WEBHOOK_URL}',
    // 	},
    // 	production: {
    // 	    endpoint: null,
    // 	    host: {
    // 		lambda: {
    // 		    arn: 'arn:aws:lambda:us-east-1:046935287063:function:dev-new-sounds-on-demand',
    // 		    askProfile: 'admin', // if left out: "default" profile is used
    // 		}
    // 	    }
    // 	}
    // }
};
