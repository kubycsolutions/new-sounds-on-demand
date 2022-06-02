import { Player } from '../player';
import { Handler } from 'jovo-core';
import { updateUserStateDatabase } from '../app'

const DEBUG=("DEBUG"==process.env.HANDLER_DEBUG)

// Alexa music-player event management for Jovo newsounds player.
// Based on the Jovo podcast player example, extended and modified.

export const AlexaHandler: Handler = {
    'AMAZON.CancelIntent'() {
        this.tell('Alright, see you next time!');
    },

    'AMAZON.PauseIntent'() {
        this.$alexaSkill!.$audioPlayer!.stop();
	this.$user.$data.inProgress = false
	if(DEBUG) console.error("DEBUG: PauseIntent inProgress=",this.$user.$data.inProgress)
    },

    'AMAZON.LoopOffIntent'() {
        this.tell('Loop Off Intent is not currently implemented by New Sounds On Demand.');
    },

    'AMAZON.LoopOnIntent'() {
        this.tell('Loop On Intent is not currently implemented by New Sounds On Demand.');
    },

    'AMAZON.RepeatIntent'() {
        this.tell('Repeat Intent is not currently implemented by New Sounds On Demand.');
    },

    'AMAZON.ShuffleOffIntent'() {
        this.tell('Shuffle Off intent is not currently implemented by New Sounds On Demand.');
    },

    'AMAZON.ShuffleOnIntent'() {
        this.tell('Shuffle On intent is not currently implemented by New Sounds On Demand.');
    },

    'AMAZON.StartOverIntent': async function() {
	// I have not been able to just "move the needle" on existing URI, so
	// I've made it a full play operation.
	// Note implications for custom Rewind/FastForward implementation.
        let currentDate = this.$user.$data.currentDate;
	if(currentDate==Player.getLiveStreamDate()) {
	    return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
	let episode=await Player.getEpisodeByDate(currentDate)
	if(!episode) {
	    console.error("startOver returned null.")
	    return this.ask("Sorry, but the I can't retrieve the last episode you were playing right now. That shouldn't happen, and I'll ask the programmers to investigate. Meanwhile, what else can I do for you?")
	}
	let uri=episode.url // won't be null if we're already playing it!
	{
	    // TODO: Finalize these and refactor to a single place
	    const keshlam_uri_parameters="user=joe.kesselman&purpose=research.for.smartspeaker.app"
	    if (uri.includes("?")) // Might already have params, though usually shouldn't.
		uri=uri+"&"+keshlam_uri_parameters
	    else
		uri=uri+"?"+keshlam_uri_parameters
	}
	this.$user.$data.inProgress = true
	if(DEBUG) console.error("DEBUG: StartOverIntent inProgress=",this.$user.$data.inProgress)
        return this.$alexaSkill!.$audioPlayer!
	    .setOffsetInMilliseconds(0) // Do not retain offset
	    .play(uri, `${currentDate}`)
    },

    AUDIOPLAYER: {
        'AlexaSkill.PlaybackStarted': async function() {
	    // TODO: PlaybackNearlyFinished is officially "outdated".
	    // However, trying to queue up the next during PlaybackStarted
	    // is apparently verboten, so the logic has been left there.
	    this.$user.$data.inProgress = true
	    if(DEBUG) console.error("DEBUG: PlaybackStarted inProgress=",this.$user.$data.inProgress)
	},
	
        'AlexaSkill.PlaybackNearlyFinished': async function() {
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==null) {
		return // Livestream never ends; no enqueued next.
	    }
	    let episode=await Player.getNextEpisodeByDate(currentDate)
            if (episode) {
	        let nextDate = episode.broadcastDateMsec
		console.log(">>> PlaybackNearlyFinished: Queued:",nextDate,episode.title)
		let uri=episode.url
		{
		    // TODO: Finalize these and refactor to a single place
		    const app_uri_parameters="user=keshlam@kubyc.solutions&nyprBrowserId=NewSoundsOnDemand.smartspeaker.player"
		    if (uri.includes("?")) // Might already have params, though usually shouldn't.
			uri=uri+"&"+app_uri_parameters
		    else
			uri=uri+"?"+app_uri_parameters
		}
                this.$alexaSkill!.$audioPlayer!
		    .setOffsetInMilliseconds(0) // Do not retain offset, if any
		    .setExpectedPreviousToken(`${currentDate}`)
		    .enqueue(uri, `${nextDate}`) // or .play(url,token,'ENQUEUE')
            }
        },

	// TODO: Can this, or playbackStarted, announce what the new episode is?
	// I have that working, mostly, in next/previous, so fallback might
	// be to skip the queue and explicitly start playback after
	// announcing...? I'm hoping the Jovo forums will give me a better
	// answer.
	//
	// TODO: Leverage fact that the index is also the playback token?
        'AlexaSkill.PlaybackFinished': async function() {
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==Player.getLiveStreamDate()) {
		console.log("Playback finished on what we think was Live Stream")
		return
	    }
	    let episode=await Player.getNextEpisodeByDate(currentDate)
	    if(episode!=null) {
		let nextDate = episode.broadcastDateMsec
		updateUserStateDatabase(this.$user.$data,nextDate,0)
            } else {
		// Leave currentDate set to the last episode
		// available, but with a flag saying we reached the
		// end of it.  We use that when later asking for
		// resume, to pick up with the next available or say
		// there isn't one.  Overloading offset this way is a
		// bit of a kluge, but it's working and resume needs
		// to look at offset anyway...
		updateUserStateDatabase(this.$user.$data,currentDate,-1)
//		this.$user.$data.offset= -1
		this.$user.$data.inProgress = false
		if(DEBUG) console.error("DEBUG: PlaybackFinished inProgress=",this.$user.$data.inProgress)
	    }
        },

        'AlexaSkill.PlaybackStopped'() {
	    // It's OK if we capture this for livestream; we just
	    // won't use it in that case.
	    updateUserStateDatabase(this.$user.$data,
			    this.$user.$data.currentDate,
			    this.$alexaSkill!.$audioPlayer!.getOffsetInMilliseconds())
//            this.$user.$data.offset = this.$alexaSkill!.$audioPlayer!.getOffsetInMilliseconds();
	    this.$user.$data.inProgress = false
	    if(DEBUG) console.error("DEBUG: PlaybackStopped inProgress=",this.$user.$data.inProgress)
        },

        'AlexaSkill.PlaybackFailed'() {
	    // TODO: Something diagnostically useful and/or practical?
            this.tell('Something unexpected happened when I tried to play that audio. Try again later, or try asking New Sounds On Demand to play something else.');
        }
    }
}
