import { Player } from '../player';
import { Handler } from 'jovo-core';

// TODO: TRY TO REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?
// Heck, Previous doesn't seem to work without "ask new sounds" prefix...

export const GoogleHandler: Handler = {
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
	    let episode=await Player.getNextEpisodeByDate(currentDate)
            if (episode) {
	        let nextDate = episode.broadcastDateMsec
		let uri=episode.url
		console.log("GOOGLE: episode.url=",episode.url)
		{
		    // TODO: Finalize these and refactor to a single place
		    var app_uri_parameters="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
		    if (uri.includes("?")) // Might already have params, though usually shouldn't.
			uri=uri+"&"+app_uri_parameters
		    else
			uri=uri+"?"+app_uri_parameters
		}
		console.log("GOOGLE: uri=",uri)
                this.$user.$data.currentDate = nextDate
                this.$googleAction!.$mediaResponse!.play(uri, episode.title);
                this.$googleAction!.showSuggestionChips(['pause', 'start over']);
		this.$speech.addText('Loading episode '+episode.title+".")
                this.ask(this.$speech);
            } else {
                this.ask('That was the most recent episode.'); // No next
            }
        },

	///////////////////////////////////////////////////////////////
	// We *should* get notification for Paused, Stopped, and Failed
	// even though Google doesn't expect us to do much in response.
	// Javascript complains that the getProgress() call isn't delared
	// on MediaResponse
	'GoogleAction.Paused'() {
	    // {
	    // 	var progress = this.$googleAction!.$audioPlayer!.getProgress();
	    // 	console.log("Google paused at", progress)
	    // }
	    // this will close the session
	    this.ask('Playback paused');
	    console.log("Google paused by",typeof this.$googleAction!.$audioPlayer)
	},
	'GoogleAction.Stopped'() {
	    // {
	    // 	var progress = this.$googleAction!.$audioPlayer!.getProgress();
	    // 	console.log("Google stopped at", progress)
	    // }
	    console.log("Google stopped by",typeof this.$googleAction!.$audioPlayer)
	    // no response possible
	},
	'GoogleAction.Failed'() {
	    this.ask('Playback failed. I\'m not sure why. Try again?');
	    console.log("Google failed")
	},

    },
}
