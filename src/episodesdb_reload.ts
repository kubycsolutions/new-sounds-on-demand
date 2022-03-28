// Reload the existing table. Mostly a development tool,
// for use when data available from the station has changed.

import {deleteTable, waitForNoTable, createTable, waitForTable,
       updateEpisodes
} from "./episodesdb"

// TODO: Need to think about whether to start loading/searching
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

reLoad(FULL_LOAD) // TEST: REBUILD MY ENTIRE DATABASE.

async function reLoad(maxdepth:number) {
    try {
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
