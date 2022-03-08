// ------------------------------------------------------------------
// JOVO/ALEXA APP CONFIGURATION
//
// Note: FileDB is being taken out of use in favor of DynamoDB, since
// Lambdas have no writable filesystem.
// ------------------------------------------------------------------

const config = {
  logging: true,

  intentMap: {
    'AMAZON.NextIntent': 'NextIntent',
    'AMAZON.PreviousIntent': 'PreviousIntent',
    'AMAZON.ResumeIntent': 'ResumeIntent',
    'AMAZON.HelpIntent': 'HelpIntent',
    'AMAZON.StopIntent': 'CancelIntent',
  },

  db: {
    FileDb: {
      pathToFile: './../../db/db.json',
    },
  },
};

export = config;
