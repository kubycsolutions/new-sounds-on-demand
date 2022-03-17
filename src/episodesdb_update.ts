import {createTable, waitForTable,
       updateEpisodes
} from "./episodesdb"

// GONK: PARAMETERIZE. Endpoint should be selectable; currently
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

const table=process.env.NSOD_EPISODES_TABLE || "episodes_debug"
const program=process.env.NSOD_PROGRAM || "newsounds"

createAndLoad(-1) // TEST: Incremental

// Note: createTable considers itself complete when the request has been accepted. We need to wait for that to complete before starting to populate it.
async function createAndLoad(maxdepth:number) {
    try {
    	try {
	    await createTable(table)
	} catch (e) {
	    // TODO: Does TS handle typed alternative catches? How?
	    // Or would I have to do my own ducktype instanceOf?
	    console.log("Expected ResoureInUseException; pre-existing table.");
	}
	await waitForTable(table)
	await callUpdateEpisodes(table,program,maxdepth)
    }
    catch(err) {
	console.log("create/update error:",err)
    }
}

async function callUpdateEpisodes(table:string,program:string,depth:number) {
    try {
	updateEpisodes(table,depth) // 0 to force rebuild, < incremental, > to specified depth
    }
    catch(e) {
	console.log("updateEpisodes:",e)
    }
}
