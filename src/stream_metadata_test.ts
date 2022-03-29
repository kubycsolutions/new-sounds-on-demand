import { Player } from './player';
import got from 'got' // HTTP(s) fetch

// Kluge for CUI
async function sleep(ms:number):Promise<any> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

doItAgain()

////////////////////////////////////////////////////////////////
// GONK: Having some duck-typing failures.
// If a property is optional, use ?:

interface Someone {
    url:string;
    pk:number;
    slug:string
    name:string;
}
interface Soloist {
    musician: Someone;
    role: string;
    instruments: string[];
}
interface RecLabel {
    url: string; // often blank
    name: string;
}
interface CatalogEntry {
    reclabel: RecLabel;
    conductor: Someone; // may be null
    composer: Someone;
    additional_composers: Someone[];
    attribution: string; // often empty
    soloists: Soloist[];
    title:string;
    length:number;
    ensemble: Someone;
    additional_ensembles:Someone[];
 }
interface PlaylistItem {
    start_time_ts: number; // seconds, not msec
    start_time: string; // NY time
    iso_start_time: string; // zulu, with 00:00 offset
    length: number; // in seconds?
    catalog_entry:CatalogEntry;
}
interface PlaylistMetadata {
    expires:string; // Not really useful?
    current_playlist_item: PlaylistItem;
}
interface Image {
    url: string;
    width: number;
    height: number;
    caption: string;
    type: string; // mimetype, typ image/jpeg
}
interface ShowItem {
    iso_start: string; // with timezone
    description: string; // may be gratuitous HTML
    fullImage: Image;  // typ ns_social-avitar.jpg, the wave-linked notes
    start_ts: number
    start_time_ts: number; // Seconds, not msec
    iso_end: string; // with tz. For radio, ~ start time of switch to episode
    listImage: Image; // typ same as fullImage
    show_url: string; // webpage
    title: string;
    url: string; // typ same as show_url
    end_ts: number;
    detailImage: Image;  // typ same as fullImage
    start: string // with offset
}
interface EpisodeMetadata {
    current_show: ShowItem
    expires:string; // Not useful
}

function isPlaylistMetadata(duckObject: any): duckObject is PlaylistMetadata {
    if((duckObject as PlaylistMetadata).current_playlist_item){
	return true
    }
    return false
}
function isEpisodeMetadata(duckObject: any): duckObject is EpisodeMetadata {
    if((duckObject as EpisodeMetadata).current_show) {
	return true
    }
    return false;
}

async function doItAgain() {
    while(true) {
	await doIt()
	console.log("\n")
	await sleep(15000)
    }
}

async function doIt() {
    var meta=await Player.getLiveStreamMetaData()
    if(isPlaylistMetadata(meta)) {
	var cat=meta.current_playlist_item.catalog_entry
	// Checking whether a datum is outdated requires that this
	// machine's clock agree with that on the server...  and it
	// looks like the server is about 10 sec late right now.
	// Could build an "I'm not sure yet" buffer into the system to
	// better tolerate clock skew...
	//
	// Fields are apparently in seconds, not msec.
	var startms:number=1000*meta.current_playlist_item.start_time_ts
	var len:number=cat.length
	var endms:number=startms+(1000*len)
	var now:number=Date.now()
	if(endms<=now) {
	    console.log("CLOCK SKEW: past expected track end time")
	    console.log("\tstart "+new Date(startms))
	    console.log("\tend ~ "+new Date(endms))
	    console.log("\tlocal "+new Date())
	}

	{
	    var cat=meta.current_playlist_item.catalog_entry

	    // Note: + concatenation is used here to prevent Node from
	    // "helpfully" coloring the date dark purple. I often use
	    // a black background for white text, so...
	    console.log("Now playing:",cat.title, "(until "+new Date(endms)+")")
	    
	    console.log("Composed by:",cat.composer.name)
	    var ac=cat.additional_composers
	    if(ac && ac.length>0) {
		console.log("\t with",ac[0].name)
		for(let i=1;i<ac.length-1;++i)
		    console.log("\t,",ac[i].name)
		console.log("\tand",ac[ac.length-1].name)
	    }

	    if(cat.ensemble)
	    {
		console.log("Performed by",cat.ensemble.name)
		var ae=cat.additional_ensembles
		if(ae && ae.length>0) {
		    console.log("\t with",ae[0].name)
		    for(let i=1;i<ae.length-1;++i)
			console.log("\t,",ae[i].name)
		    console.log("\tand",ae[ae.length-1].name)
		}
	    }
	    
	    if(cat.soloists) {
		formatSoloists(cat.soloists)
	    }
	    if(cat.conductor)
		console.log("Under the direction of",cat.conductor.name)
	}
    } else if (isEpisodeMetadata(meta)) {
	// NOTE: For playlist items, this is *also* true, reporting
	// the episode as belonging to New Sounds Radio.  Right now
	// its iso_end reports as midnight EST, which is when the
	// scheduled episode comes on...
	console.log("Episode of",meta.current_show.title)
	// expires doesn't seem to be anything useful. Server time?
	// end_ts doesn't seem to be anything useful. for show Duration in msec?
	console.log("iso_end:",meta.current_show.iso_end)
    } else {
	console.error("\nvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv")
	console.error("Ducktype failed")
	console.error(JSON.stringify(meta,null,4))
	console.error("vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv\n")
    }

}

function formatSoloists(sl:Soloist[]) {
    if(sl && sl.length>0) {
	console.log("\t featuring")
	formatSoloist(sl[0])
	for(let i=1;i<sl.length-1;++i){
	    formatSoloist(sl[i])
	}
	if(sl.length>1) {
	    console.log("\t and")
	    formatSoloist(sl[sl.length-1])
	}
    }
}
function formatSoloist(soloist:Soloist) {
    console.log("\t",soloist.musician.name)
    if(soloist.role) console.log("\t\t as",soloist.role)
    if(soloist.instruments && soloist.instruments.length>0) {
	console.log("\t\t playing",soloist.instruments[0])
	for(let i=1;i<soloist.instruments.length-1;++i)
	    console.log("\t\t\t,",soloist.instruments[i])
	if(soloist.instruments.length>1) 
	    console.log("\t\t\tand",soloist.instruments[soloist.instruments.length-1])
    }
}
