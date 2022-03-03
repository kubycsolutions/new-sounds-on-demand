// EARLY DEV TEST DRIVER

'use strict;'

// CONSTANTS FOR NOW, WILL WANT OVERRIDES
// TODO: Should table name be a param to updateEpisodes? Meh...
const TABLE_NAME="Episodes_test"
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
const AWS=set_AWS_endpoint("http://localhost:8000","us-east-1")
console.log("AWS:",AWS)
createAndLoad(-1)

// Note: createTable considers itself complete when the request has been accepted. We need to wait for that to complete before starting to populate it.
function createAndLoad(maxdepth:number) {
    createTable(TABLE_NAME)
	.then( () => { // Run whether create succeeded or not
	    return waitForTable(TABLE_NAME)
		.then(()=>callUpdateEpisodes(0)) // New table, populate
		.catch(err=>console.log("waitForTable failed",err)) // TODO: REVIEW
	})
	.catch(()=>callUpdateEpisodes(maxdepth)) // Existing table, update
}

function callUpdateEpisodes(depth:number) {
    console.log("DEBUG: UPDATE MODE",depth)
    updateEpisodes(depth) // 0 to force rebuild, < incremental, > to specified depth
    .catch((e:any) => console.log(e))
    .finally(() => console.log("update final"))
}
