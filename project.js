// ------------------------------------------------------------------
// JOVO PROJECT CONFIGURATION
// ------------------------------------------------------------------

module.exports = {
    stages: {
	local: {
	    endpoint: '${JOVO_WEBHOOK_URL}'
	},
	lambda: {
  	    arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
 	    askProfile: 'admin', // if left out: "default" profile is used
	    endpoint: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand'
	}
    },
    alexaSkill: {
	nlu: 'alexa',
	"manifest": {
		"apis": {
			"custom": {
				"endpoint": {
					"sslCertificateType": "Wildcard",
					"uri": "arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand"
				},
				"interfaces": [
					{
						"type": "AUDIO_PLAYER"
					}
				]
			}
		},
		"manifestVersion": "1.0",
		"privacyAndCompliance": {
			"allowsPurchases": false,
			"containsAds": false,
			"isChildDirected": false,
			"isExportCompliant": true,
			"locales": {
				"en-US": {
					"privacyPolicyUrl": "http://wqxr.org/privacy/",
					"termsOfUseUrl": "http://wqxr.org/terms/"
				}
			},
			"usesPersonalInfo": false
		},
		"publishingInformation": {
			"automaticDistribution": {
				"isActive": false
			},
			"category": "STREAMING_SERVICE",
			"distributionCountries": [],
			"isAvailableWorldwide": true,
			"locales": {
				"en-US": {
					"description": "New Sounds is \"A daily showcase of weird and wonderful music from artists, composers and musicians — all gleefully oblivious of their genres.\" It's an excellent resource for learning about music and performers that American radio stations don't (or didn't) often play. Each episode is centered around playing (and explaining) examples which meet that day's theme, ranging from historic to ultramodern, traditional to avant-garde, soloists to orchestras, drum and voice to synth and computer, and all the possible combinations thereof.\n\nThere have been over 4500 unique episodes of the daily show since the early 1980s, with new ones still being added, and most of them can now be played from the station's servers.  There is also a 24/7 live stream, less themed and with less commentary but playing the same wide range of music.\n\nTYPICAL COMMANDS (we accept synonyms of these, so feel free to try whatever wording is most comfortable for you):\n\n\"Alexa, open New Sounds On Demand\" -- Enters interactive mode, where the skill reminds you of some of the things it can do and asks you to pick one. Recommended for new users.\n\n\"Alexa, ask New Sounds On Demand to...\" followed by any of the other commands skips the \"what do you want to do\" interaction and immediately executes the command.\n\n\"... Play the newest episode.\" -- Play the episode most recently broadcast on the daily radio program.\n\n\"... Catch up.\" -- Resumes playing recent episodes you haven't heard yet. Also known as \"Podcast mode\" or \"What's new\".\n\n\"... Play the oldest program.\" -- Play the episode from the earliest broadcast date we have in the database.\n\n\"... Play the highest show.\" -- Play the  show with the highest episode number, which will be the one that was _produced_ (as opposed to broadcast) most recently. KNOWN BUG: If you say \"highest numbered\",  the skill may get confused and ask you which number to play. If that happens, just say \"highest\" again and it'll understand you.\n\n\"... Play the lowest-numbered broadcast.\" -- Play Episode 1, the first episode to be nationally syndicated. New Sounds actually launched several years before that, but right now this is about as far back as our archives can reach.\n\n\"... Play episode four thousand.\"  -- Select a specific episode number.  Alexa accepts most ways of saying numbers.\n\n\"... Play the show from this Monday.\" -- Select a show by date. NOTE: Alexa accepts most phrasings of dates, but tends to interpret them as meaning the *next* date which matches that description -- hence \"this Monday\" rather than \"Monday\" in the example. If you say something that Alexa thinks is in the future, the skill will ask you to rephrase the request.\n\n\"... Play a random show.\" -- Surprise yourself. (In fact \"Surprise me\" is one of the synonyms for this.)\n\n\"... Play the live stream.\" -- 24-hour continuous new-music programming, covering just about anything that might appear on New Sounds. Twice a day, that includes an actual episode of the show, otherwise minimal talking.\n\n\"... What are we listening to?\" -- If you're playing the live stream this will tell you the song name, composer, and performers currently being played. When playing episodes we can't yet get minute-by-minute playlist information, but we can tell you the show's title and theme, and give you the episode number or date so you can come back to it easily.\n\n\"... Roll the credits.\" -- Learn more about who brings us New Sounds, and who developed this Skill.\n\nOnce the audio is playing, you can use many of Alexa's standard playback controls -- next and previous (by date), stop/pause, resume/continue, restart (rewind to start of this recording). KNOWN LIMITATION: If you stop late in a show, ask Alexa to do other things, and then resume, Alexa may take a long time to figure out where playback was stopped.",
					"examplePhrases": [
						"Alexa, open New Sounds On Demand.",
						"Alexa, ask New Sounds On Demand to play the most recent episode.",
						"Alexa, ask New Sounds On Demand to play the live stream."
					],
					"keywords": [
						"afrofuturism",
						"ambient",
						"balkan",
						"chamber",
						"discover",
						"downtown",
						"early",
						"eclectic",
						"electroacoustic",
						"electronic",
						"gamelan",
						"improvised",
						"indie",
						"invented",
						"jazz",
						"minimalism",
						"modern",
						"music",
						"neoclassical",
						"post-rock",
						"new",
						"old",
						"schaefer",
						"soundscape",
						"surprising",
						"unexpected",
						"unusual",
						"wnyc",
						"world",
						"wqxr"
					],
					"largeIconUri": "https://s3.amazonaws.com/CAPS-SSE/echo_developer/936a/b43415014cef46a2933d343704b59a7d/APP_ICON_LARGE?versionId=xTYtE.zyvwHkU1HjUIeUw5MWNo.sJ.NM&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20220615T175729Z&X-Amz-SignedHeaders=host&X-Amz-Expires=86400&X-Amz-Credential=AKIAWBV6LQ4QPLOTC37V%2F20220615%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=2e0519104af7762e63528d3e82658eac75ad44cb0af254ee38b5ea2acf26dc96",
					"name": "New Sounds On Demand",
					"smallIconUri": "https://s3.amazonaws.com/CAPS-SSE/echo_developer/f75d/7e7008557ff94e94b13b9119bec32547/APP_ICON?versionId=zkVSeZMvUFws71Y7el7ECgNfolgFyk17&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20220615T175729Z&X-Amz-SignedHeaders=host&X-Amz-Expires=86400&X-Amz-Credential=AKIAWBV6LQ4QPLOTC37V%2F20220615%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=a9bffa485e686ff3d322bd0e78925d647b401eadcc91f8d08849c873ff9e61e9",
					"summary": "Cross-genre \"New Music\" from NY Public Radio's \"New Sounds\" (https://newsounds.org). New daily episodes, 40 years of archived shows, 24/7 live stream.",
					"updatesDescription": "\"Catch up\" is a minimal podcast-like behavior; it knows what the most recently broadcast episode you played was (and whether you stopped in the middle of it) and picks up playing from that point. Note that this is different from \"Continue\", which continues from where you last stopped even if that was in an older episode or the livestream. \n\nThere have also been some improvements in Echo Show support, though it isn't fully polished yet."
				}
			},
			"testingInstructions": "No special instructions. State is currently maintained per user, *not* per device; I'm considering changing this."
		}
	}
    },
    googleAction: {
	nlu: 'dialogflow',
	projectId: `new-sounds-on-demand`,
    },

    // MANUAL DEV/PROD SWITCHING: Comment out either endpoint: or host:.
    //     host: {
    // 	lambda: {
    // 	    arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
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
    // 		    arn: 'arn:aws:lambda:us-east-1:046935287063:function:prod-new-sounds-on-demand',
    // 		    askProfile: 'admin', // if left out: "default" profile is used
    // 		}
    // 	    }
    // 	}
    // }
};
