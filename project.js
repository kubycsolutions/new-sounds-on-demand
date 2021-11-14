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
                     type: 'AUDIO_PLAYER'
                  }
               ]
            }
         }
      },
   },
   googleAction: {
       // nlu: 'dialogflow',
       projectId: `new-sounds-on-demand`,
   },
   // endpoint: '${JOVO_WEBHOOK_URL}', // talk to 'jovo run' instance
    host: {
	lambda: {
            arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
            askProfile: 'admin', // if left out: "default" profile is used
	}
    }
};
