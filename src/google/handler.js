// TODO: MAKE SURE WE REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?

const Player = require('../player.js');

module.exports = {
    AUDIOPLAYER: {
	// ISSUE: Does this get called as side effect of navigation?
        'GoogleAction.Finished': async function() {
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==null) {
		return // Livestream never ends; no enqueued next.
	    }
	    await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
            let nextDate = Player.getNextEpisodeDate(currentDate);
	    let episode=Player.getEpisodeByDate(nextDate)
            if (episode) {
		{
		    // TODO: Finalize these and refactor to a single place
		    const keshlam_uri_parameters="user=joe.kesselman&purpose=research.for.smartspeaker.app"
		    if (uri.includes("?")) // Might already have params, though usually shouldn't.
			uri=uri+"&"+keshlam_uri_parameters
		    else
			uri=uri+"?"+keshlam_uri_parameters
		}
                this.$user.$data.currentDate = nextDate
                this.$googleAction.$mediaResponse.play(uri, episode.title);
                this.$googleAction.showSuggestionChips(['pause', 'start over']);
		this.$speech.addText('Loading and resuming episode '+episode.title+".")
                this.ask(this.$speech);
            } else {
                this.tell(''); // No next
            }
        }
    },
}
