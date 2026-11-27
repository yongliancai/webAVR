// Keep every learner asset request tied to the document version on screen.
export function mediaRevisionQuery(revision){if(revision==null)return '';if(!Number.isInteger(revision)||revision<1||revision>2147483647)throw Error('INVALID_MEDIA_REVISION');return '?revision='+revision;}
export function mediaDownloadUrl(url){return url+(url.includes('?')?'&':'?')+'download=1';}
