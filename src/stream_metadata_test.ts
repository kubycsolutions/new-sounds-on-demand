import { Player } from './player';
import got from 'got' // HTTP/HTTPS fetch

// Kluge for CUI
async function sleep(ms:number):Promise<any> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

doItAgain()

////////////////////////////////////////////////////////////////
// For ducktyping, if a property is optional use ?: rather than :

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
    description: string; // may be gratuitously HTML, may be simple text.
    // For stream, typically ns_social-avitar.jpg, the wave-linked notes.
    // For episode, typically the artist image
    fullImage: Image;  
    start_ts: number
    start_time_ts: number; // Seconds, not msec
    iso_end: string; // with tz. For radio, ~ start time of switch to episode
    listImage: Image; // typ same as fullImage, but smaller size specified.
    show_url: string; // webpage
    title: string; // For episode, "#nnnn, Short Title"
    url: string; // typ same as show_url
    end_ts: number;
    detailImage: Image;  // typ same as listImage
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
	await sleep(30000)
    }
}

async function doIt() {
    var meta=await Player.getLiveStreamMetaData()
    if(isPlaylistMetadata(meta)) {
	var cat=meta.current_playlist_item.catalog_entry

	// Checking whether a datum is outdated requires that this
	// machine's clock agree with that on the server...  and it
	// looks like the metadata server is a minute or two late
	// right now.  That requires deskewing logic here.
	//
	// Fields are in seconds, not msec.
	//
	// ODDITY: There will sometimes be a late instance of an old
	// response after three or so correct reponses. It's possible
	// that the station has multiple servers responsing in
	// round-robin, one of which is updating well after the
	// others. I think it's OK to say "not sure" in this case,
	// since it does correct itself on subsequent queries.
	//
	// Do we need to worry about skew the other way?
	var startms:number=1000*meta.current_playlist_item.start_time_ts
	var len:number=cat.length
	var endms:number=startms+(1000*len)
	var now:number=Date.now()
	if(endms<=now || startms>=now) {
	    console.log("CLOCK SKEW: outside expected track time")
	    console.log("\tstart "+new Date(startms))
	    console.log("\tend ~ "+new Date(endms))
	    console.log("\tlocal "+new Date())
	    console.log("\tI'm not sure. Let me listen for another minute or two, then ask again.")
	}
	else
	{
	    var cat=meta.current_playlist_item.catalog_entry

	    var title=cat.title
	    var composers=formatAllComposers(cat)
	    var ensembles=formatAllEnsembles(cat)
	    var soloists=formatSoloists(cat)
	    var conductor=cat.conductor

	    var buffer="Now playing: \""+title+"\""
	    if(composers) buffer+=", composed by "+composers
	    if(ensembles) buffer+=", performed by "+ensembles
	    if(soloists) buffer+=", featuring "+soloists
	    if(conductor) buffer+=", under the direction of"+conductor.name

	    console.log(buffer)
	}
    } else if (isEpisodeMetadata(meta)) {
	// NOTE: For playlist items, this is *also* true, reporting
	// the episode as belonging to New Sounds Radio and giving as its
	// iso_end the time when we switch to an episode. Not useful for my
	// purposes right now.
	//
	// For actual episodes, meta.current_show.title reports the
	// episode name, number and all. That's convenient.  (May want
	// to copy the fix-nonstandard-title logic here, though recent
	// episodes are probably more regularly named than old ones.)
	//
	// GONK: OPEN ISSUE: The livestream meta server is sometimes
	// *not* reporting the right episode's title/description. Not
	// much I can do about that except to say only "an episode of
	// the daily New Sounds program" and leave it at that. This
	// one has to be fixed by the station's IT folks.

	console.error("SUSPECT DATA: It's an episode, but probably not the one stated unless the server bug has been fixed.")
	// console.log("New Sounds",meta.current_show.title)
	// console.log(meta.current_show.description)
	console.log("An episode of the New Sounds daily show.")
    } else {
	console.error("\nvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv")
	console.error("Ducktype failed; data not in expected format")
	console.error(JSON.stringify(meta,null,4))
	console.error("^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n")
	console.error("I'm not sure. Try asking again in a minute or two.")
    }

}

function formatSoloists(cat:CatalogEntry):(string|null) {
    var s:(string|null)=null
    var sl=cat.soloists;
    if(sl && sl.length>0) {
	s=formatSoloist(sl[0])
	for(let i=1;i<sl.length-1;++i)
	    s+="; "+formatSoloist(sl[i])
	if(sl.length>1) {
	    s+=" and "+formatSoloist(sl[sl.length-1])
	}
    }
    return s
}

function formatSoloist(soloist:Soloist):(string|null) {
    // Note: Some records confuse/entangle these fields.
    // We could try to detect that, but I think there's 
    // significant risk of making matters worse rather than better.
    // We could at least detect role==instrument...
    //
    // "On" or "playing" sounds a bit odd when the instrument is vocal.
    // Any ideas for better phrasing? I'm currently using "as" for role.
    var s:(string|null)=soloist.musician.name
    if(soloist.role) s+=" as "+soloist.role
    if(soloist.instruments && soloist.instruments.length>0) {
	s+=" on "+soloist.instruments[0]
	for(let i=1;i<soloist.instruments.length-1;++i)
	    s+=", "+soloist.instruments[i]
	if(soloist.instruments.length>1) 
	    s+=" and"+soloist.instruments[soloist.instruments.length-1]
    }
    return s
}

function formatAllComposers(cat:CatalogEntry):(string|null) {
    var s:(string|null)=null
    if(cat.composer) {
	s=cat.composer.name
	var ac=cat.additional_composers
	if(ac && ac.length>0) {
	    s+=", "+ac[0].name
	    for(let i=1;i<ac.length-1;++i)
		s+=", "+ac[i].name
	    if(ac.length>1)
		s+=" and "+ac[ac.length-1].name
	}
    }
    return s
}

function formatAllEnsembles(cat:CatalogEntry):(string|null) {
    var s:(string|null)=null
    if(cat.ensemble)
    {
	s=cat.ensemble.name
	var ae=cat.additional_ensembles
	if(ae && ae.length>0) {
	    s+=", with "+ae[0].name
	    for(let i=1;i<ae.length-1;++i)
		s+=", "+ae[i].name
	    s+=" and "+ae[ae.length-1].name
	}
    }
    return s
}
