import {deleteTable, waitForNoTable, createTable, waitForTable,
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

const table="episodes_debug" // Not the production table!
const program="newsounds"

// Since we're starting by emptying the table, depth of -1
// (incremental) and 0 (full replacement) are effectively equivalent.
recreateAndLoad(0) // TEST: REBUILD MY ENTIRE DATABASE.

// Note: deleteTable and createTable return when the request has been
// accepted. We apparently need to wait for the operation to complete
// before advancing to next operation; DynamoDB does not automatically
// queue up requests behind blockers (unless immediate consistency
// requested??)
async function recreateAndLoad(maxdepth:number) {
    try {
	await deleteTable(table);
	await waitForNoTable(table);
    } catch(err:any) {
	console.log("Error removing table; hopefully means didn't exist:",err)
    }
    try {
	await createTable(table)
	await waitForTable(table)
	await callUpdateEpisodes(table,program,maxdepth) // Full, since recreating
    }
    catch(err:any) {
	console.log("create/update error:",err)
    }
}

async function callUpdateEpisodes(table:string,program:string,depth:number) {
    try {
	updateEpisodes(table,depth) // 0 to force rebuild, < incremental, > to specified depth
    }
    catch(e:any) {
	console.log("updateEpisodes:",e)
    }
}
