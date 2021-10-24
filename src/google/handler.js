// TODO: TRY TO REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?
// Heck, Previous doesn't seem to work without "ask new sounds" prefix...

const Player = require('../player.js');

module.exports = {
    AUDIOPLAYER: {
	// GONK ISSUE: Prefixless "Next" is winding up here, with
	// no sign of a NextIntent. Sort-of okay since I happen to have
	// implemented automatic play-next-when-this-ends, but in general
	// not a flexible solution. And I haven't yet figured out if
	// and how Google Assistant implements "Previous" -- it accepts
	// the word, but I'm not seeing any event come in.
        'GoogleAction.Finished': async function() {
	    console.log("GOOGLE: Finished")
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==null) {
		return // Livestream never ends; no enqueued next.
	    }
	    await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
            let nextDate = Player.getNextEpisodeDate(currentDate);
	    let episode=Player.getEpisodeByDate(nextDate)
            if (episode) {
		let uri=episode.url
		console.log("GOOGLE: episode.url=",episode.url)
		{
		    // TODO: Finalize these and refactor to a single place
		    const app_uri_parameters="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
		    if (uri.includes("?")) // Might already have params, though usually shouldn't.
			uri=uri+"&"+app_uri_parameters
		    else
			uri=uri+"?"+app_uri_parameters
		}
		console.log("GOOGLE: uri=",uri)
                this.$user.$data.currentDate = nextDate
                this.$googleAction.$mediaResponse.play(uri, episode.title);
                this.$googleAction.showSuggestionChips(['pause', 'start over']);
		this.$speech.addText('Loading episode '+episode.title+".")
                this.ask(this.$speech);
            } else {
                this.ask('That was the most recent episode.'); // No next
            }
        },

	// GONK: Does Jovo let us catch these? If not, why not?
        'GoogleAction.Paused': async function() {
	    this.ask("New Sounds paused.")
	},
        'GoogleAction.Stopped': async function() {
	    this.ask("New Sounds stopped.")
	},
        'GoogleAction.Failed': async function() {
	    // GONK: Can we do something more usefully diagnostic?
	    this.ask("New Sounds had a playback failure.")
	},

    },
}
