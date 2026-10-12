/* -*- tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */
/*
   Copyright 2011 notmasteryet

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// - The JPEG specification can be found in the ITU CCITT Recommendation T.81
//   (www.w3.org/Graphics/JPEG/itu-t81.pdf)
// - The JFIF specification can be found in the JPEG File Interchange Format
//   (www.w3.org/Graphics/JPEG/jfif3.pdf)
// - The Adobe Application-Specific JPEG markers in the Supporting the DCT Filters
//   in PostScript Level 2, Technical Note #5116
//   (partners.adobe.com/public/developer/en/ps/sdk/5116.DCT_Filter.pdf)


// Adapted locally from jpeg-js 0.4.4: IDCT/Huffman kernel retained; bounded
// baseline parser and direct oriented MCU-row output replace whole-image buffers.
// See bounded-baseline-jpeg.LICENSE for upstream redistribution terms.
  var dctZigZag = new Int32Array([
     0,
     1,  8,
    16,  9,  2,
     3, 10, 17, 24,
    32, 25, 18, 11, 4,
     5, 12, 19, 26, 33, 40,
    48, 41, 34, 27, 20, 13,  6,
     7, 14, 21, 28, 35, 42, 49, 56,
    57, 50, 43, 36, 29, 22, 15,
    23, 30, 37, 44, 51, 58,
    59, 52, 45, 38, 31,
    39, 46, 53, 60,
    61, 54, 47,
    55, 62,
    63
  ]);

  var dctCos1  =  4017   // cos(pi/16)
  var dctSin1  =   799   // sin(pi/16)
  var dctCos3  =  3406   // cos(3*pi/16)
  var dctSin3  =  2276   // sin(3*pi/16)
  var dctCos6  =  1567   // cos(6*pi/16)
  var dctSin6  =  3784   // sin(6*pi/16)
  var dctSqrt2 =  5793   // sqrt(2)
  var dctSqrt1d2 = 2896  // sqrt(2) / 2

  function buildHuffmanTable(codeLengths, values) {
    var k = 0, code = [], i, j, length = 16;
    while (length > 0 && !codeLengths[length - 1])
      length--;
    code.push({children: [], index: 0});
    var p = code[0], q;
    for (i = 0; i < length; i++) {
      for (j = 0; j < codeLengths[i]; j++) {
        p = code.pop();
        p.children[p.index] = values[k];
        while (p.index > 0) {
          if (code.length === 0)
            throw new Error('Could not recreate Huffman Table');
          p = code.pop();
        }
        p.index++;
        code.push(p);
        while (code.length <= i) {
          code.push(q = {children: [], index: 0});
          p.children[p.index] = q.children;
          p = q;
        }
        k++;
      }
      if (i + 1 < length) {
        // p here points to last code
        code.push(q = {children: [], index: 0});
        p.children[p.index] = q.children;
        p = q;
      }
    }
    return code[0].children;
  }

    function quantizeAndInverse(zz, dataOut, dataIn, qt) {
      var v0, v1, v2, v3, v4, v5, v6, v7, t;
      var p = dataIn;
      var i;

      // dequant
      for (i = 0; i < 64; i++)
        p[i] = zz[i] * qt[i];

      // inverse DCT on rows
      for (i = 0; i < 8; ++i) {
        var row = 8 * i;

        // check for all-zero AC coefficients
        if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 &&
            p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 &&
            p[7 + row] == 0) {
          t = (dctSqrt2 * p[0 + row] + 512) >> 10;
          p[0 + row] = t;
          p[1 + row] = t;
          p[2 + row] = t;
          p[3 + row] = t;
          p[4 + row] = t;
          p[5 + row] = t;
          p[6 + row] = t;
          p[7 + row] = t;
          continue;
        }

        // stage 4
        v0 = (dctSqrt2 * p[0 + row] + 128) >> 8;
        v1 = (dctSqrt2 * p[4 + row] + 128) >> 8;
        v2 = p[2 + row];
        v3 = p[6 + row];
        v4 = (dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
        v7 = (dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
        v5 = p[3 + row] << 4;
        v6 = p[5 + row] << 4;

        // stage 3
        t = (v0 - v1+ 1) >> 1;
        v0 = (v0 + v1 + 1) >> 1;
        v1 = t;
        t = (v2 * dctSin6 + v3 * dctCos6 + 128) >> 8;
        v2 = (v2 * dctCos6 - v3 * dctSin6 + 128) >> 8;
        v3 = t;
        t = (v4 - v6 + 1) >> 1;
        v4 = (v4 + v6 + 1) >> 1;
        v6 = t;
        t = (v7 + v5 + 1) >> 1;
        v5 = (v7 - v5 + 1) >> 1;
        v7 = t;

        // stage 2
        t = (v0 - v3 + 1) >> 1;
        v0 = (v0 + v3 + 1) >> 1;
        v3 = t;
        t = (v1 - v2 + 1) >> 1;
        v1 = (v1 + v2 + 1) >> 1;
        v2 = t;
        t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
        v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
        v7 = t;
        t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
        v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
        v6 = t;

        // stage 1
        p[0 + row] = v0 + v7;
        p[7 + row] = v0 - v7;
        p[1 + row] = v1 + v6;
        p[6 + row] = v1 - v6;
        p[2 + row] = v2 + v5;
        p[5 + row] = v2 - v5;
        p[3 + row] = v3 + v4;
        p[4 + row] = v3 - v4;
      }

      // inverse DCT on columns
      for (i = 0; i < 8; ++i) {
        var col = i;

        // check for all-zero AC coefficients
        if (p[1*8 + col] == 0 && p[2*8 + col] == 0 && p[3*8 + col] == 0 &&
            p[4*8 + col] == 0 && p[5*8 + col] == 0 && p[6*8 + col] == 0 &&
            p[7*8 + col] == 0) {
          t = (dctSqrt2 * dataIn[i+0] + 8192) >> 14;
          p[0*8 + col] = t;
          p[1*8 + col] = t;
          p[2*8 + col] = t;
          p[3*8 + col] = t;
          p[4*8 + col] = t;
          p[5*8 + col] = t;
          p[6*8 + col] = t;
          p[7*8 + col] = t;
          continue;
        }

        // stage 4
        v0 = (dctSqrt2 * p[0*8 + col] + 2048) >> 12;
        v1 = (dctSqrt2 * p[4*8 + col] + 2048) >> 12;
        v2 = p[2*8 + col];
        v3 = p[6*8 + col];
        v4 = (dctSqrt1d2 * (p[1*8 + col] - p[7*8 + col]) + 2048) >> 12;
        v7 = (dctSqrt1d2 * (p[1*8 + col] + p[7*8 + col]) + 2048) >> 12;
        v5 = p[3*8 + col];
        v6 = p[5*8 + col];

        // stage 3
        t = (v0 - v1 + 1) >> 1;
        v0 = (v0 + v1 + 1) >> 1;
        v1 = t;
        t = (v2 * dctSin6 + v3 * dctCos6 + 2048) >> 12;
        v2 = (v2 * dctCos6 - v3 * dctSin6 + 2048) >> 12;
        v3 = t;
        t = (v4 - v6 + 1) >> 1;
        v4 = (v4 + v6 + 1) >> 1;
        v6 = t;
        t = (v7 + v5 + 1) >> 1;
        v5 = (v7 - v5 + 1) >> 1;
        v7 = t;

        // stage 2
        t = (v0 - v3 + 1) >> 1;
        v0 = (v0 + v3 + 1) >> 1;
        v3 = t;
        t = (v1 - v2 + 1) >> 1;
        v1 = (v1 + v2 + 1) >> 1;
        v2 = t;
        t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
        v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
        v7 = t;
        t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
        v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
        v6 = t;

        // stage 1
        p[0*8 + col] = v0 + v7;
        p[7*8 + col] = v0 - v7;
        p[1*8 + col] = v1 + v6;
        p[6*8 + col] = v1 - v6;
        p[2*8 + col] = v2 + v5;
        p[5*8 + col] = v2 - v5;
        p[3*8 + col] = v3 + v4;
        p[4*8 + col] = v3 - v4;
      }

      // convert to 8-bit integers
      for (i = 0; i < 64; ++i) {
        var sample = 128 + ((p[i] + 8) >> 4);
        dataOut[i] = sample < 0 ? 0 : sample > 0xFF ? 0xFF : sample;
      }
    }


export class UnsupportedBaselineJPEGError extends Error {
  constructor(reason) { super('图片格式处理限制，原照已保留，无需重复上传。'); this.name='UnsupportedBaselineJPEGError'; this.code='JPEG_BASELINE_UNSUPPORTED'; this.reason=reason; }
}
function invalid(reason) { const e=new Error('JPEG数据不完整或格式异常，原照已保留。');e.code='JPEG_BASELINE_INVALID';e.reason=reason;throw e; }
function limit(reason) { const e=new Error('照片解码超出本轮安全处理范围，原照已保留。');e.code='JPEG_BASELINE_LIMIT';e.reason=reason;throw e; }
const clamp8=x=>x<0?0:x>255?255:x;
/** Decode only 8-bit SOF0 single-scan gray/YCbCr. Never resizes or re-encodes. */
export function decodeBaselineJPEG(bytes, options={}) {
  if(!(bytes instanceof Uint8Array)||bytes.length<4)invalid('missing bytes');
  if(bytes.length>10*1024*1024)limit('compressed input exceeds 10MiB');
  const maxMB=options.maxMemoryUsageInMB??96,maxMP=options.maxResolutionInMP??12.6,orientation=options.orientation??1;
  if(!Number.isFinite(maxMB)||maxMB<=0||maxMB>96||!Number.isFinite(maxMP)||maxMP<=0||maxMP>12.6)limit('invalid limits');
  if(!Number.isInteger(orientation)||orientation<1||orientation>8)invalid('invalid orientation');
  const maximum=maxMB*1024*1024;let allocated=0;
  const reserve=n=>{if(!Number.isSafeInteger(n)||n<0||allocated+n>maximum)limit('bounded allocation');allocated+=n;};
  // Charge the existing input and a conservative metadata/scratch allowance,
  // although input is borrowed (not copied). Huffman tree overhead is charged per table.
  reserve(bytes.byteLength+4096);
  let at=0,frame=null,restartInterval=0,adobe=null,decoded=null,segments=0;
  const qtables=[],dcTables=[],acTables=[];
  function u8(){if(at>=bytes.length)invalid('truncated byte');return bytes[at++];}
  function u16(){const hi=u8();return hi*256+u8();}
  function marker(){if(u8()!==255)invalid('missing marker');let value=u8();while(value===255)value=u8();if(value===0)invalid('stuffed byte outside scan');return value;}
  if(u16()!==0xffd8)invalid('missing SOI');
  while(at<bytes.length){
    if(++segments>1024)limit('too many segments');
    const code=marker();
    if(code===0xd9){if(!decoded)invalid('missing image scan');if(at!==bytes.length)invalid('bytes after EOI');return {...decoded,decodeEvidence:{revision:'bounded-baseline-mcu-row-20261010-candidate',allocatedBytes:allocated,maxMemoryUsageBytes:maximum,mcuRows:frame.rows,sampling:frame.components.map(c=>[c.h,c.v]),orientation,fullImageCopies:1,inputCopied:false}};}
    if(decoded)invalid('only one complete scan supported');
    if(code===0xd8||code===0x01||(code>=0xd0&&code<=0xd7))invalid('unexpected standalone marker');
    const length=u16(),end=at+length-2;
    if(length<2||end>bytes.length)invalid('truncated segment');
    if(code>=0xe0&&code<=0xef||code===0xfe){
      if(code===0xee&&end-at>=12&&String.fromCharCode(...bytes.subarray(at,at+5))==='Adobe')adobe=bytes[at+11];
      at=end;continue;
    }
    if(code===0xdb){
      while(at<end){const spec=u8(),id=spec&15;if((spec>>4)!==0)throw new UnsupportedBaselineJPEGError('16-bit quantization unsupported');if(id>3||end-at<64)invalid('bad quantization table');reserve(256);const q=new Int32Array(64);for(let j=0;j<64;j++){const n=u8();if(n===0)invalid('zero quantizer');q[dctZigZag[j]]=n;}qtables[id]=q;}
    }else if(code===0xc4){
      while(at<end){const spec=u8(),kind=spec>>4,id=spec&15;if(kind>1||id>3||end-at<16)invalid('bad Huffman table');const lengths=new Uint8Array(16);let count=0,slots=1;for(let j=0;j<16;j++){lengths[j]=u8();count+=lengths[j];slots=slots*2-lengths[j];if(slots<0)invalid('oversubscribed Huffman table');}if(count<1||count>256||end-at<count)invalid('bad Huffman value count');reserve(65536);const values=new Uint8Array(count);for(let j=0;j<count;j++){const n=u8();if(kind===0?n>11:(n&15)>10||((n&15)===0&&n!==0&&n!==0xf0))invalid('non-baseline Huffman symbol');values[j]=n;}(kind===0?dcTables:acTables)[id]=buildHuffmanTable(lengths,values);}
    }else if(code===0xc0){
      if(frame)invalid('multiple frames');const precision=u8(),height=u16(),width=u16(),count=u8();
      if(precision!==8)throw new UnsupportedBaselineJPEGError('only 8-bit baseline');
      if(width<1||height<1||width*height>maxMP*1e6)limit('resolution exceeds bound');
      if(count!==1&&count!==3)throw new UnsupportedBaselineJPEGError('only gray or YCbCr');
      if(length!==8+3*count)invalid('SOF length mismatch');const components=[];
      for(let j=0;j<count;j++){const id=u8(),sampling=u8(),qId=u8(),h=sampling>>4,v=sampling&15;if(components.some(c=>c.id===id)||qId>3||h<1||v<1)invalid('bad component');components.push({id,h,v,qId,pred:0});}
      const y=components[0];
      if(count===1?(y.h!==1||y.v!==1):!(components.map(c=>c.id).join(',')==='1,2,3'&&[[1,1],[2,1],[2,2]].some(([h,v])=>y.h===h&&y.v===v)&&components.slice(1).every(c=>c.h===1&&c.v===1)))throw new UnsupportedBaselineJPEGError('unsupported component order or sampling');
      frame={width,height,components,maxH:y.h,maxV:y.v,columns:Math.ceil(width/(8*y.h)),rows:Math.ceil(height/(8*y.v))};
    }else if(code===0xdd){if(length!==4)invalid('DRI length');restartInterval=u16();
    }else if(code===0xda){
      if(!frame)invalid('SOS before SOF');if(frame.components.length===3&&adobe!==null&&adobe!==1)throw new UnsupportedBaselineJPEGError('RGB/CMYK Adobe transform');
      const count=u8();if(count!==frame.components.length)throw new UnsupportedBaselineJPEGError('noninterleaved or incomplete scan');if(length!==6+2*count)invalid('SOS length mismatch');
      for(let j=0;j<count;j++){const id=u8(),spec=u8(),c=frame.components[j];if(id!==c.id)throw new UnsupportedBaselineJPEGError('scan component order');c.dc=dcTables[spec>>4];c.ac=acTables[spec&15];c.q=qtables[c.qId];if(!c.dc||!c.ac||!c.q)invalid('missing decode tables');}
      if(u8()!==0||u8()!==63||u8()!==0)throw new UnsupportedBaselineJPEGError('non-baseline scan parameters');
      if(at!==end)invalid('scan header mismatch');decoded=decodeScanRows(frame);continue;
    }else if((code>=0xc1&&code<=0xcf&&![0xc4,0xc8,0xcc].includes(code))||code===0xcc||code===0xdc)throw new UnsupportedBaselineJPEGError('non-baseline JPEG coding');
    else throw new UnsupportedBaselineJPEGError('unsupported marker');
    if(at!==end)invalid('segment length mismatch');
  }
  invalid('missing EOI');

  function decodeScanRows(f){
    const swap=orientation>=5,width=swap?f.height:f.width,height=swap?f.width:f.height;
    reserve(width*height*4);const output=new Uint8Array(width*height*4);
    // One entropy block and IDCT scratch are reused for the whole image.
    const coefficients=new Int32Array(64),scratch=new Int32Array(64),samples=new Uint8Array(64);
    for(const c of f.components){c.stride=f.columns*c.h*8;reserve(c.stride*c.v*8);c.plane=new Uint8Array(c.stride*c.v*8);}
    let bits=0,bitCount=0,mcuCount=0,restart=0;
    const bit=()=>{if(bitCount===0){bits=u8();if(bits===255&&u8()!==0)invalid('unexpected marker in entropy');bitCount=8;}return(bits>>--bitCount)&1;};
    const huffman=tree=>{let node=tree;for(let depth=0;depth<16;depth++){node=node?.[bit()];if(typeof node==='number')return node;if(!Array.isArray(node))invalid('invalid Huffman code');}invalid('Huffman code too long');};
    const receive=n=>{let value=0;for(let j=0;j<n;j++)value=(value<<1)|bit();return n&&value<(1<<(n-1))?value+(-1<<n)+1:value;};
    for(let row=0;row<f.rows;row++){
      for(let col=0;col<f.columns;col++){
        for(const c of f.components)for(let by=0;by<c.v;by++)for(let bx=0;bx<c.h;bx++){
          coefficients.fill(0);c.pred+=receive(huffman(c.dc));if(Math.abs(c.pred)>2047)invalid('DC predictor out of range');coefficients[0]=c.pred;
          for(let k=1;k<64;){const symbol=huffman(c.ac),size=symbol&15,run=symbol>>4;if(size===0){if(run===0)break;if(run!==15||k+16>64)invalid('invalid AC zero run');k+=16;continue;}k+=run;if(k>=64)invalid('AC coefficient outside block');coefficients[dctZigZag[k++]]=receive(size);}
          quantizeAndInverse(coefficients,samples,scratch,c.q);
          for(let y=0;y<8;y++)c.plane.set(samples.subarray(y*8,y*8+8),(by*8+y)*c.stride+(col*c.h+bx)*8);
        }
        mcuCount++;
        if(restartInterval&&mcuCount%restartInterval===0&&mcuCount<f.columns*f.rows){if(bitCount>0&&(bits&((1<<bitCount)-1))!==((1<<bitCount)-1))invalid('non-one restart padding');bitCount=0;if(marker()!==0xd0+(restart++%8))invalid('wrong restart marker');for(const c of f.components)c.pred=0;}
      }
      for(let ly=0;ly<f.maxV*8&&row*f.maxV*8+ly<f.height;ly++)for(let x=0;x<f.width;x++){
        const yy=row*f.maxV*8+ly,yc=f.components[0];let red=yc.plane[ly*yc.stride+x],green=red,blue=red;
        if(f.components.length===3){const cb=f.components[1],cr=f.components[2],cx=Math.floor(x/f.maxH),cy=Math.floor(ly/f.maxV),Cb=cb.plane[cy*cb.stride+cx]-128,Cr=cr.plane[cy*cr.stride+cx]-128;green=clamp8(red-.3441363*Cb-.71413636*Cr);blue=clamp8(red+1.772*Cb);red=clamp8(red+1.402*Cr);}
        let nx=x,ny=yy;if(orientation===2)nx=f.width-1-x;else if(orientation===3){nx=f.width-1-x;ny=f.height-1-yy;}else if(orientation===4)ny=f.height-1-yy;else if(orientation===5){nx=yy;ny=x;}else if(orientation===6){nx=f.height-1-yy;ny=x;}else if(orientation===7){nx=f.height-1-yy;ny=f.width-1-x;}else if(orientation===8){nx=yy;ny=f.width-1-x;}
        const p=(ny*width+nx)*4;output[p]=red;output[p+1]=green;output[p+2]=blue;output[p+3]=255;
      }
    }
    // Validate byte padding. jpeg-js's encoder emits one complete all-ones
    // padding byte (FF 00) when entropy ends exactly on a byte boundary.
    // Accept that single known form, never arbitrary extra entropy data.
    if(bitCount>0&&(bits&((1<<bitCount)-1))!==((1<<bitCount)-1))invalid('non-one entropy padding');
    if(bitCount===0&&bytes[at]===255&&bytes[at+1]===0)at+=2;
    bitCount=0;if(at>=bytes.length||bytes[at]!==255)invalid('extra entropy bytes');
    return {width,height,data:output};
  }
}
