import {getStreamMetadataText} from "./stream_metadata"
import {Player} from "./player"

// Kluge; JS has no official sleep function but it does have timeout.
async function sleep(ms:number):Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

doItAgain()

async function doItAgain() {
    while(true) {
	try {
	    console.log(await getStreamMetadataText())
	    console.log("\n")
	}
	catch (e) {
	    console.error(e)
	    console.error("... Continuing timed loop")
	}
	await sleep(30000)
    }
}
