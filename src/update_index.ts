import {createTable, waitForTable,
       updateEpisodes
} from "./episodesdb"

// ------------------------------------------------------------------
// Scheduled database update lambda entry point
// ABSOLUTELY MINIMAL IMPLEMENTATION -- hardwired, no params, just
// kick off an update.
// ------------------------------------------------------------------

const table=process.env.NSOD_EPISODES_TABLE || "episodes_debug"
const maxdepth=-1 // // 0 to force rebuild, < incremental, > to specified depth

// GONK: PARAMETERIZE. Endpoint and program should be selectable; currently
// hardwired. Also, need to think about whether to start
// loading/searching multiple shows to include Soundcheck, since it's
// the other "recorded live" part of NewSounds... which will require
// parameterizing the station-database URI since I don't think there's
// an all-shows query thereupon. (Though their API *is* mostly
// undocumented, so it may have more flexibility than I've been able
// to access. Ideal, of course, would be to be able to run the
// smartspeaker app directly against their data, but the part of the
// API I've figured out isn't flexibile enough for more than paged
// access.)

// Minimal AWS Lambda entry point
export const handler = async (event: any, context: any, callback: Function) => {
    try {
	var result=await updateEpisodes(table,maxdepth)
	console.log("updateEpisodes returned",result)
	return "Ending normally."
    } catch(e) {
	console.error("updateEpisodes threw",e)
	throw e
    }
};
