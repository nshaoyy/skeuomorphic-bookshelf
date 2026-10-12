// SPDX-License-Identifier: AGPL-3.0-only
// Plain JavaScript so the same file runs in Node (server) and is served to browsers (/lib/metadata.js).
/** Lossless metadata removal shared by the browser and the server. Pixels are never re-encoded.
 * JPEG: drops APP1 (Exif incl. GPS, XMP), APP13 (IPTC) and COM before the first scan; keeps
 * colour-relevant segments (APP0 JFIF, APP2 ICC, APP14 Adobe) and re-adds a minimal Exif holding
 * only the orientation, which the server decoder uses to upright the photo.
 * PNG: drops eXIf and text chunks (tEXt/zTXt/iTXt). Unknown or malformed input is returned as-is. */
const dropJpeg=new Set([0xe1,0xed,0xfe]);

export function jpegOrientation(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=2;
 while(at+4<bytes.length&&bytes[at]===0xff){
  const marker=bytes[at+1];if(marker===0xda||marker===0xd9)break;
  const length=v.getUint16(at+2);if(length<2||at+2+length>bytes.length)break;
  if(marker===0xe1&&length>=16&&String.fromCharCode(...bytes.subarray(at+4,at+10))==='Exif\0\0'){
   const t=at+10,end=at+2+length,le=v.getUint16(t)===0x4949;
   if(v.getUint16(t+2,le)!==42)return 1;
   const dir=t+v.getUint32(t+4,le);if(dir+2>end)return 1;
   for(let n=0,count=v.getUint16(dir,le);n<count;n++){
    const p=dir+2+n*12;if(p+12>end)break;
    if(v.getUint16(p,le)===0x0112){const o=v.getUint16(p+8,le);return o>=1&&o<=8?o:1;}
   }
   return 1;
  }
  at+=2+length;
 }
 return 1;
}

function orientationSegment(orientation){
 // "Exif\0\0" + big-endian TIFF header + one IFD0 entry (0x0112 SHORT 1 = orientation) + next-IFD 0.
 const body=[0x45,0x78,0x69,0x66,0,0,0x4d,0x4d,0,42,0,0,0,8,0,1,0x01,0x12,0,3,0,0,0,1,0,orientation,0,0,0,0,0,0];
 const len=body.length+2;return [0xff,0xe1,len>>8,len&0xff,...body];
}

export function stripJpegMetadata(bytes){
 if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return bytes;
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const keep=[];let at=2,dropped=false;
 while(true){
  if(at+4>bytes.length||bytes[at]!==0xff)return bytes; // malformed header: leave untouched
  const marker=bytes[at+1];
  if(marker===0xda)break; // first scan: everything after is image data
  if(marker===0xd9||marker===0x01||(marker>=0xd0&&marker<=0xd7))return bytes;
  const length=v.getUint16(at+2);if(length<2||at+2+length>bytes.length)return bytes;
  if(dropJpeg.has(marker))dropped=true;else keep.push([at,at+2+length]);
  at+=2+length;
 }
 if(!dropped)return bytes;
 const orientation=jpegOrientation(bytes),extra=orientation===1?[]:orientationSegment(orientation);
 const size=2+extra.length+keep.reduce((n,[a,b])=>n+b-a,0)+(bytes.length-at);
 const out=new Uint8Array(size);let o=0;
 out.set([0xff,0xd8],o);o+=2;
 // JFIF (APP0) must stay first when present; the orientation Exif follows it.
 const first=keep.length&&bytes[keep[0][0]+1]===0xe0?1:0;
 for(const [a,b] of keep.slice(0,first)){out.set(bytes.subarray(a,b),o);o+=b-a;}
 out.set(extra,o);o+=extra.length;
 for(const [a,b] of keep.slice(first)){out.set(bytes.subarray(a,b),o);o+=b-a;}
 out.set(bytes.subarray(at),o);
 return out;
}

const dropPng=new Set(['eXIf','tEXt','zTXt','iTXt']);
export function stripPngMetadata(bytes){
 const sig=[137,80,78,71,13,10,26,10];
 if(bytes.length<8||sig.some((b,i)=>bytes[i]!==b))return bytes;
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const keep=[];let at=8,dropped=false;
 while(at+12<=bytes.length){
  const len=v.getUint32(at),end=at+12+len;if(end>bytes.length)return bytes;
  const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
  if(dropPng.has(type))dropped=true;else keep.push([at,end]);
  at=end;if(type==='IEND')break;
 }
 if(!dropped)return bytes;
 const out=new Uint8Array(8+keep.reduce((n,[a,b])=>n+b-a,0)+(bytes.length-at));
 out.set(bytes.subarray(0,8));let o=8;
 for(const [a,b] of keep){out.set(bytes.subarray(a,b),o);o+=b-a;}
 out.set(bytes.subarray(at),o);
 return out;
}

export function stripPhotoMetadata(bytes,mime){
 return mime==='image/jpeg'?stripJpegMetadata(bytes):mime==='image/png'?stripPngMetadata(bytes):bytes;
}
