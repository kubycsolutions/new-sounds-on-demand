import { Player } from '../player';
import { Handler } from 'jovo-core';

// Alexa music-player event management for Jovo newsounds player.
// Based on the Jovo podcast player example, extended and modified.

export const AlexaHandler: Handler = {
    'AMAZON.CancelIntent'() {
        this.tell('Alright, see you next time!');
    },

    'AMAZON.PauseIntent'() {
        this.$alexaSkill!.$audioPlayer!.stop();
	// Do I need to log index/offset here to make sure we resume in the
	// right mode? Or does this trigger Playback Stopped, qv?
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

    'AMAZON.StartOverIntent'() {
	// I have not been able to just "move the needle" on existing URI, so
	// I've made it a full play operation. (Minus the episode ID voiceover.)
	// Note implications for custom Rewind/FastForward implementation.
        let currentDate = this.$user.$data.currentDate;
	if(currentDate==Player.getLiveStreamDate()) {
	    return this.tell("You can't move forward or back in the livestream. That kind of control is only available when playing episodes.");
	}
	let episode=Player.getEpisodeByIndex(currentDate)
	let uri=episode!.url // won't be null if we're already playing it!
	{
	    // TODO: Finalize these and refactor to a single place
	    const keshlam_uri_parameters="user=joe.kesselman&purpose=research.for.smartspeaker.app"
	    if (uri.includes("?")) // Might already have params, though usually shouldn't.
		uri=uri+"&"+keshlam_uri_parameters
	    else
		uri=uri+"?"+keshlam_uri_parameters
	}
        return this.$alexaSkill!.$audioPlayer!
	    .setOffsetInMilliseconds(0) // Do not retain offset
	    .play(uri, `${currentDate}`)
    },

    AUDIOPLAYER: {
	// TODO: PlaybackNearlyFinished is officially "outdated".
	// However, trying to queue up the next during PlaybackStarted
	// is apparently verboten, so the logic has been left there.
        'AlexaSkill.PlaybackStarted'() {
	},
	
	// TODO: Implement continue along multiple axes -- fwd,
	// bkwd, by date or ep#. That actually probably belongs in
	// Player's next/prev...
        'AlexaSkill.PlaybackNearlyFinished': async function() {
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==null) {
		return // Livestream never ends; no enqueued next.
	    }
	    await Player.updateEpisodes(-1) // Incremental load, in case new appeared.
            let nextDate = Player.getNextEpisodeIndex(currentDate);
	    let episode=Player.getEpisodeByIndex(nextDate)
            if (episode) {
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
        'AlexaSkill.PlaybackFinished'() {
            let currentDate = this.$user.$data.currentDate;
	    if (currentDate==Player.getLiveStreamDate()) {
		console.log("Playback finished on what we think was Live Stream")
		return
	    }
            let nextDate = Player.getNextEpisodeIndex(currentDate);
	    if(nextDate>0) {
		let episode=Player.getEpisodeByIndex(nextDate)
                this.$user.$data.currentDate = nextDate;
            } else {
		// "Resume" after play-to-stop of last ep
		// was starting with that ep's starting offset.
		// It should say none-such if we were on last ep.
		// Leave myself a note to that effect in this.$user.%data,
		// by setting a negative offset (otherwise impossible).
		this.$user.$data.offset= -1
	    }
        },

        'AlexaSkill.PlaybackStopped'() {
	    // It's OK if we capture this for livestream; we just
	    // won't use it in that case.
            this.$user.$data.offset = this.$alexaSkill!.$audioPlayer!.getOffsetInMilliseconds();
        },

        'AlexaSkill.PlaybackFailed'() {
	    // TODO: Something diagnostically useful and/or practical?
            this.tell('Something unexpected happened when I tried to play that audio. Try again later, or try asking New Sounds On Demand to play something else.');
        }
    }
}
