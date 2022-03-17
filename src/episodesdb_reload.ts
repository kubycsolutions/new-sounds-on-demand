import {deleteTable, waitForNoTable, createTable, waitForTable,
       updateEpisodes
} from "./episodesdb"

// GONK: Need to think about whether to start loading/searching
// multiple shows to include Soundcheck, since it's the other
// "recorded live" part of NewSounds... which will require
// parameterizing the station-database URI, or doing an all-shows
// query thereupon if that's supported.

const table=process.env.NSOD_EPISODES_TABLE || "episodes_debug"
const program=process.env.NSOD_PROGRAM || "newsounds"

// Since we're starting by emptying the table, depth of -1
// (incremental) and 0 (full replacement) are effectively equivalent.
const INCREMENTAL_LOAD=-1
const FULL_LOAD=0
const TWO_PAGE_LOAD=2

recreateAndLoad(FULL_LOAD) // TEST: REBUILD MY ENTIRE DATABASE.

// Note: deleteTable and createTable return when the request has been
// accepted. We need to wait for the operation to complete before
// advancing to next operation; DynamoDB does NOT automatically have
// operations block those which might depend upon them.
async function recreateAndLoad(maxdepth:number) {
    try {
	await deleteTable(table);
	console.log("Awaiting removal of table",table)
	await waitForNoTable(table);
	console.log("Confirmed no table!")
    } catch(err) {
	console.log("Error removing table; hopefully means didn't exist:",err)
    }
    try {
	await createTable(table)
	console.log("Awaiting creation of table",table)
	await waitForTable(table)
	console.log("Table exists, starting load with maxdepth",maxdepth)
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
