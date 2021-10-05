// TODO: MAKE SURE WE REPLICATE THE LOGIC BURIED IN THE ALEXA HANDLER.
// Cancel? Pause? Start Over? Stopped (logging index/offset)?

const Player = require('../player.js');

module.exports = {
    AUDIOPLAYER: {
        'GoogleAction.Finished'() {
            let index = this.$user.$data.currentIndex;
	    let newIndex=Player.getNextIndex(index);
            let episode = Player.getEpisodeByIndex(newIndex);
            if (episode) {
                this.$user.$data.currentIndex = newIndex
                this.$googleAction.$mediaResponse.play(episode.url, episode.title);
                this.$googleAction.showSuggestionChips(['pause', 'start over']);
                this.ask('Enjoy');
            } else {
                this.tell('');
            }
        }
    },
}
