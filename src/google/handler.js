// TODO: MAKE SURE WE REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?

const Player = require('../player.js');

module.exports = {
    AUDIOPLAYER: {
        'GoogleAction.Finished'() {
            let index = this.$user.$data.currentDate;
	    let newDate=Player.getNextDate(index);
            let episode = Player.getEpisodeByDate(newDate);
            if (episode) {
                this.$user.$data.currentDate = newDate
                this.$googleAction.$mediaResponse.play(episode.url, episode.title);
                this.$googleAction.showSuggestionChips(['pause', 'start over']);
                this.ask('Enjoy');
            } else {
                this.tell('');
            }
        }
    },
}
