import { Player } from './player';
import got from 'got' // HTTP/HTTPS fetch

const DEBUG=("DEBUG"==process.env.STREAM_METADATA_DEBUG)

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
    reclabel: RecLabel; // Unfortunately, album title is not provided.
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

// Return reasonably full description as a human string. We may want
// subsets of this in response to the specific intents -- who is
// playing, who sings, how long, what album, who produced. Alas,
// metadata available is not a direct match to these questions; I can
// *try* searching instruments for voice/vocal/voice-part to
// distinguish the first two, and we do have length, but we don't seem
// to have album name or producer (though we do have label).
export async function getStreamMetadataText():Promise<string> {
    var meta=await Player.getLiveStreamMetaData()
    if(DEBUG) console.error("\nDEBUG:",JSON.stringify(meta,null,4),"\n")
    if(isPlaylistMetadata(meta)) {
	var cat=meta.current_playlist_item.catalog_entry

	// Checking whether a datum is outdated requires that this
	// machine's clock agree with that on the server...  and it
	// looks like the metadata server is a minute or two late
	// right now.  That requires deskewing logic here.
	//
	// Length is in seconds, not msec -- or at least that's what
	// appears to be correct, modulo the deskewing issue.
	//
	// ISSUE: I'm sometimes getting a genuinely outdated response
	// after a good response. Skew testing will handle it, but that,
	// like the skew, needs to be fixed on the producers' server.
	var startms:number=1000*meta.current_playlist_item.start_time_ts
	var len:number=cat.length
	
	var endms:number=startms+(1000*len)
	var now:number=Date.now()
	if(endms<=now || startms>=now) {
	    console.error("CLOCK SKEW: outside expected track time")
	    console.error("\tstart "+new Date(startms))
	    console.error("\tend ~ "+new Date(endms))
	    console.error("\tlocal "+new Date())
	    // Since this should resolve shortly, encourage another attempt.
	    return "I'm not sure. Let me listen for another minute or two, then ask again."
	}
	else
	{
	    var cat=meta.current_playlist_item.catalog_entry

	    var title=cat.title
	    var composers=formatAllComposers(cat)
	    var ensembles=formatAllEnsembles(cat)
	    var soloists=formatSoloists(cat)
	    var conductor=cat.conductor
	    var pub=formatPublisher(cat)

	    var buffer="Now playing: \""+title+"\""
	    if(composers) buffer+=", composed by "+composers
	    if(ensembles) buffer+=", performed by "+ensembles
	    if(soloists) buffer+=", featuring "+soloists
	    if(conductor) buffer+=", under the direction of "+conductor.name
	    if(pub) buffer+=". Published by "+pub
	    buffer+="."
	    buffer+=" It runs "+Math.floor(len/60)+" minutes and "+len%60+" seconds."
	    
	    return buffer;
	}
    } else if (isEpisodeMetadata(meta)) {
	// NOTE: For playlist items, this is *also* true, reporting
	// the episode as belonging to New Sounds Radio and giving as its
	// iso_end the time when we switch to an episode. Not relevant
	// right now.
	//
	// For actual episodes, meta.current_show.title should be reporting
	// episode name, number and all. Great. BUT...
	//
	// GONK: OPEN ISSUE: The livestream meta server seems to
	// always report the "most recent" episode, *NOT* the one
	// currently being played in the livestream. This one
	// has to be fixed by the station's IT folks.
	console.error("SUSPECT DATA: It's an episode, but probably not the one stated. Server bug.")
	console.error("CLAIMS TO BE: New Sounds",meta.current_show.title)
	return "Now playing: An episode of the daily New Sounds show, via the New Sounds Live Stream."
    } else {
	console.error("\nvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv")
	console.error("Ducktype failed; data not in expected format")
	console.error(JSON.stringify(meta,null,4))
	console.error("^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\n")
	// Semi-friendly error message for users.
	return "I'm not sure. Try asking again in a minute or two."
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
	    s+=" and "+soloist.instruments[soloist.instruments.length-1]
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

function formatPublisher(cat:CatalogEntry):(string|null) {
    if(cat.reclabel 
       && cat.reclabel.name 
       && cat.reclabel.name.length>0) {
	return pronounceMap(cat.reclabel.name);
    }
    else
	return null;
}

// Known pronunciation problem patcher.  Javascript doesn't have a map
// literal, but this essentially compiles to one.
//
// There are also a lot of typos in the database where someone
// misspelled cantaloupe; since I have this hook, I'm fixing some of
// that here.
function pronounceMap(name:string):string {
    switch(name.toLowerCase()) {
    case "jwmusic.org": return "J W Music dot org" // not "jewmusic dot org";
    case "canalope music": return "Cantaloupe Music" // distracted intern
    default: return name
    }
}
