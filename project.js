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
      nlu: 'dialogflow',
   },
   // endpoint: '${JOVO_WEBHOOK_URL}',
    host: {
	lambda: {
            arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
            askProfile: 'admin', // if left out: "default" profile is used
	}
    }
};
