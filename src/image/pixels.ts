import jpeg from 'jpeg-js';
import {decodeBaselineJPEG,UnsupportedBaselineJPEGError} from './bounded-baseline-jpeg.js';
import { decode, encode, convertIndexedToRgb } from 'fast-png';
import {validateQuad, type Quad} from './geometry.ts';
export type Raster={width:number;height:number;data:Uint8Array};
const maxPixels=12_600_000; // Includes a standard 4032 × 3024 phone photograph.
function dimensions(width:number,height:number){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>maxPixels)throw new Error('照片尺寸不支持，请使用手机标准尺寸照片。');}
/** Cheap upload preflight only. Full decode and integrity validation happen in the queue before any model request. */
export function inspectBookPhoto(bytes:Uint8Array,mime:string){
 if(!bytes.length||bytes.length>10*1024*1024)throw new Error('照片大小不支持。');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(mime==='image/png'){
  if(bytes.length<33||!Buffer.from(bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))||v.getUint32(8)!==13||v.getUint32(12)!==0x49484452)throw new Error('PNG照片格式不正确。');
  const width=v.getUint32(16),height=v.getUint32(20);dimensions(width,height);return {width,height};
 }
 if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
  let at=2;
  while(at+4<=bytes.length){
   if(bytes[at]!==255)break;while(at<bytes.length&&bytes[at]===255)at++;
   const marker=bytes[at++];if(marker===0xda||marker===0xd9)break;
   if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   if(at+2>bytes.length)break;const length=v.getUint16(at);if(length<2||at+length>bytes.length)break;
   if([0xc0,0xc1,0xc2].includes(marker)){
    if(length<8)break;if(bytes[at+2]!==8)throw new Error('暂不支持此JPEG颜色深度，原照已保留。');const height=v.getUint16(at+3),width=v.getUint16(at+5);dimensions(width,height);return {width,height};
   }
   at+=length;
  }
 }
 throw new Error('照片格式或尺寸无法读取。');
}
function exifOrientation(bytes:Uint8Array){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=2;
 while(at+4<bytes.length&&bytes[at]===255){
  const marker=bytes[at+1];if(marker===218||marker===217)break;
  const length=v.getUint16(at+2);if(length<2||at+2+length>bytes.length)break;
  if(marker===225&&length>=16&&String.fromCharCode(...bytes.slice(at+4,at+10))==='Exif\0\0'){
   const t=at+10,le=v.getUint16(t)===0x4949;
   if(v.getUint16(t+2,le)!==42)return 1;
   const directory=t+v.getUint32(t+4,le),end=at+2+length;
   if(directory+2>end)return 1;
   const count=v.getUint16(directory,le);
   for(let n=0;n<count;n++){
    const p=directory+2+n*12;if(p+12>end)break;
    if(v.getUint16(p,le)===0x0112&&v.getUint16(p+2,le)===3&&v.getUint32(p+4,le)===1){const o=v.getUint16(p+8,le);return o>=1&&o<=8?o:1;}
   }
  }
  at+=length+2;
 }
 return 1;
}
function orient(r:Raster,o:number):Raster{
 if(o===1)return r;
 const swap=o>=5,w=swap?r.height:r.width,h=swap?r.width:r.height,data=new Uint8Array(w*h*4);
 for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
  let nx=x,ny=y;
  if(o===2)nx=r.width-1-x;
  if(o===3){nx=r.width-1-x;ny=r.height-1-y;}
  if(o===4)ny=r.height-1-y;
  if(o===5){nx=y;ny=x;}
  if(o===6){nx=r.height-1-y;ny=x;}
  if(o===7){nx=r.height-1-y;ny=r.width-1-x;}
  if(o===8){nx=y;ny=r.width-1-x;}
  const from=(y*r.width+x)*4,to=(ny*w+nx)*4;data.set(r.data.subarray(from,from+4),to);
 }
 return {width:w,height:h,data};
}
export function decodeBookPhoto(bytes:Uint8Array,mime:string):Raster{
 if(!bytes.length||bytes.length>10*1024*1024)throw new Error('照片大小不支持。');
 if(mime==='image/jpeg'){
  if(bytes[0]!==255||bytes[1]!==216)throw new Error('JPEG照片格式不正确。');
  // Read dimensions before allocating a full raster. Baseline decoding reuses one
  // MCU row and writes directly to the EXIF-oriented output; original bytes stay intact.
  const size=inspectBookPhoto(bytes,mime),orientation=exifOrientation(bytes);
  try{return decodeBaselineJPEG(bytes,{maxResolutionInMP:12.6,maxMemoryUsageInMB:96,orientation});}
  catch(error){
   // Only an explicitly unsupported coding mode may use the established decoder.
   // Corrupt streams and budget errors must not trigger a second decode attempt.
   if(!(error instanceof UnsupportedBaselineJPEGError))throw error;
   if(size.width*size.height>3_000_000)throw new Error('这张照片的 JPEG 编码暂不支持大图处理，原照已保留。');
   const r=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:3,maxMemoryUsageInMB:96});dimensions(r.width,r.height);
   return orient({width:r.width,height:r.height,data:r.data},orientation);
  }
 }
 if(mime==='image/png'){
  if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)throw new Error('PNG照片格式不正确。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);dimensions(view.getUint32(16),view.getUint32(20));
  const r=decode(bytes,{checkCrc:true});
  if(r.palette){const data=convertIndexedToRgb(r),channels=data.length/(r.width*r.height);const rgba=new Uint8Array(r.width*r.height*4);for(let p=0;p<r.width*r.height;p++){rgba.set(data.subarray(p*channels,p*channels+3),p*4);rgba[p*4+3]=channels===4?data[p*channels+3]:255;}return {width:r.width,height:r.height,data:rgba};}
  if(r.depth!==8)throw new Error('暂不支持此PNG颜色深度。');
  // Generated RGBA PNGs already have the required layout; avoid a full-image
  // JavaScript channel conversion and a second 8MB allocation.
  if(r.channels===4)return {width:r.width,height:r.height,data:new Uint8Array(r.data.buffer,r.data.byteOffset,r.data.byteLength)};
  const data=new Uint8Array(r.width*r.height*4);
  for(let p=0;p<r.width*r.height;p++){
   const from=p*r.channels,to=p*4;
   if(r.channels<=2){data[to]=data[to+1]=data[to+2]=r.data[from];data[to+3]=r.channels===2?r.data[from+1]:255;}
   else{data[to]=r.data[from];data[to+1]=r.data[from+1];data[to+2]=r.data[from+2];data[to+3]=r.channels===4?r.data[from+3]:255;}
  }
  return {width:r.width,height:r.height,data};
 }
 throw new Error('多书照片暂支持JPEG和PNG，请使用手机原始JPG照片。');
}
export function encodeBookPhoto(r:Raster){dimensions(r.width,r.height);if(r.data.length!==r.width*r.height*4)throw new Error('图片像素不完整。');return encode({width:r.width,height:r.height,data:r.data,channels:4,depth:8});}
/** Neutral margins satisfy editing input dimensions without resizing book pixels. */
export function padBookReference(r:Raster):Raster{
 const height=Math.max(384,r.height),width=Math.max(384,r.width,Math.ceil(height/2));dimensions(width,height);
 const data=new Uint8Array(width*height*4);for(let p=0;p<data.length;p+=4){data[p]=32;data[p+1]=32;data[p+2]=29;data[p+3]=255;}
 const x=Math.floor((width-r.width)/2),y=Math.floor((height-r.height)/2);
 for(let row=0;row<r.height;row++)data.set(r.data.subarray(row*r.width*4,(row+1)*r.width*4),((y+row)*width+x)*4);
 return {width,height,data};
}
/** Projective sampling maps output pixel centres to the original photograph. */
export function extractBook(r:Raster,quad:Quad):Raster{
 validateQuad(quad);
 const p=quad.map(([x,y])=>[x*(r.width-1)/1000,y*(r.height-1)/1000]);
 const distance=(a:number[],b:number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const width=Math.max(1,Math.round((distance(p[0],p[1])+distance(p[3],p[2]))/2));
 const height=Math.max(1,Math.round((distance(p[0],p[3])+distance(p[1],p[2]))/2));dimensions(width,height);
 const [a,b,c,d]=p,dx1=b[0]-c[0],dx2=d[0]-c[0],dx3=a[0]-b[0]+c[0]-d[0],dy1=b[1]-c[1],dy2=d[1]-c[1],dy3=a[1]-b[1]+c[1]-d[1];
 const denominator=dx1*dy2-dx2*dy1;
 if(Math.abs(denominator)<1e-8)throw new Error('书脊区域无法校正。');
 const g=(dx3*dy2-dx2*dy3)/denominator,h=(dx1*dy3-dx3*dy1)/denominator;
 const ax=b[0]-a[0]+g*b[0],bx=d[0]-a[0]+h*d[0],ay=b[1]-a[1]+g*b[1],by=d[1]-a[1]+h*d[1];
 const data=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=(x+.5)/width,v=(y+.5)/height,div=g*u+h*v+1;
  if(Math.abs(div)<1e-8)throw new Error('书脊透视校正无效。');
  const sx=(ax*u+bx*v+a[0])/div,sy=(ay*u+by*v+a[1])/div;
  if(!Number.isFinite(sx)||!Number.isFinite(sy)||sx<0||sy<0||sx>r.width-1||sy>r.height-1)throw new Error('书脊区域超出原照。');
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,r.width-1),y1=Math.min(y0+1,r.height-1),fx=sx-x0,fy=sy-y0;
  for(let k=0;k<4;k++)data[(y*width+x)*4+k]=Math.round((r.data[(y0*r.width+x0)*4+k]*(1-fx)+r.data[(y0*r.width+x1)*4+k]*fx)*(1-fy)+(r.data[(y1*r.width+x0)*4+k]*(1-fx)+r.data[(y1*r.width+x1)*4+k]*fx)*fy);
 }
 return {width,height,data};
}
