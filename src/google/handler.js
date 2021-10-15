// TODO: MAKE SURE WE REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?

const Player = require('../player.js');

module.exports = {
    AUDIOPLAYER: {
	// ISSUE: Does this get called as side effect of navigation?
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
		// GONK: Should this be ask or tell?
                this.tell('That was the most recent episode.'); // No next
            }
        }
    },
}
