// EARLY DEV TEST DRIVER

'use strict;'

// CONSTANTS FOR NOW, WILL WANT OVERRIDES
// TODO: Should table name be a param to updateEpisodes? Meh...
const TABLE_NAME="episodes"
const PROGRAM="newsounds"

import {set_AWS_endpoint, 
        updateEpisodes,
	EpisodeRecord,

	createTable, waitForTable, waitForNoTable, describeTable,
	deleteTable,

	getItemForDate, getItemForEarliestDate, getItemForLatestDate,
	getItemsForEpisode, getItemForHighestEpisode,
	getItemForLowestEpisode, getNextItemByDate,
	getNextItemByEpisode, getPreviousItemByDate,
	getPreviousItemByEpisode, getRandomItem

       } from './episodesdb'

//----------------------------------------------------------------
// GONK: Endpoint should be selectable; currently defaulting to local.
console.log("GONK1")
set_AWS_endpoint("http://localhost:8000","us-east-1") 
console.log("GONK2")

var depthParam:string = process.argv[2] // "node", "pathToScript", "arg"...
var depth=-1

if(!depthParam || depthParam.charAt(0)=='i')
    depth=-1
else if (depthParam.charAt(0)=='f')
    depth=0
else
    depth=parseInt(depthParam)

console.log("DEBUG: UPDATE MODE",depth)
updateEpisodes(depth) // 0 to force rebuild, < incremental, > to specified depth

