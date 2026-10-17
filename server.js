import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=express();
const root=path.dirname(fileURLToPath(import.meta.url));
app.use(express.json());
app.use(express.static(path.join(root,'public')));
const port=process.env.PORT||3000;
const YT_KEY=process.env.YOUTUBE_API_KEY||process.env.YOUTUBE_APIKEY;
const RAPID_KEY=process.env.RAPIDAPI_KEY;
// Satu RAPIDAPI_HOST dipakai untuk endpoint YouTube/TikTok/Instagram pada API baru.
const MEDIA_HOST=process.env.RAPIDAPI_HOST||'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com';
// Host lama khusus endpoint MP3 /api/download.
const RAPI_HOST=process.env.RAPI_HOST||'yt-search-and-download-mp3.p.rapidapi.com';

app.get('/api/suggest',async(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,100);
  if(q.length<1)return res.json([]);
  if(!YT_KEY)return res.status(503).json({error:'API YouTube belum dikonfigurasi.'});
  try{
    const u=new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({part:'snippet',type:'video',videoCategoryId:'10',maxResults:'8',q,key:YT_KEY}).forEach(([k,v])=>u.searchParams.set(k,v));
    const r=await fetch(u);const data=await r.json();
    if(!r.ok)throw new Error(data.error?.message||'Saran pencarian gagal');
    res.json((data.items||[]).map(x=>({id:x.id.videoId,title:x.snippet.title,channel:x.snippet.channelTitle,thumbnail:x.snippet.thumbnails?.default?.url})));
  }catch(e){res.status(502).json({error:e.message})}
});

app.get('/api/search',async(req,res)=>{
  const q=String(req.query.q||'').trim();
  if(!q)return res.status(400).json({error:'Masukkan judul lagu dulu.'});
  if(!YT_KEY)return res.status(503).json({error:'API YouTube belum dikonfigurasi di Railway.'});
  try{
    const u=new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({part:'snippet',type:'video',videoCategoryId:'10',maxResults:'12',q,key:YT_KEY}).forEach(([k,v])=>u.searchParams.set(k,v));
    const r=await fetch(u); const data=await r.json();
    if(!r.ok)throw new Error(data.error?.message||'Pencarian YouTube gagal');
    res.json((data.items||[]).map(x=>({id:x.id.videoId,title:x.snippet.title,channel:x.snippet.channelTitle,thumbnail:x.snippet.thumbnails?.high?.url||x.snippet.thumbnails?.default?.url})));
  }catch(e){res.status(502).json({error:e.message})}
});

app.get('/api/download',async(req,res)=>{
  const videoId=String(req.query.videoId||'');
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))return res.status(400).json({error:'ID video tidak valid.'});
  if(!RAPID_KEY)return res.status(503).json({error:'RAPIDAPI_KEY belum dipasang pada environment backend.'});
  try{
    const u=new URL(`https://${RAPI_HOST}/mp3`);
    u.searchParams.set('url',`https://www.youtube.com/watch?v=${videoId}`);
    const r=await fetch(u,{headers:{accept:'*/*','x-rapidapi-host':RAPI_HOST,'x-rapidapi-key':RAPID_KEY}});
    const data=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(data?.message||data?.error||`RapidAPI HTTP ${r.status}`);
    if(!data?.success||typeof data.download!=='string')throw new Error(data?.message||data?.error||'Respons API MP3 tidak berisi link download.');
    const fileUrl=new URL(data.download);
    if(fileUrl.protocol!=='https:')throw new Error('URL audio tidak valid.');
    const audio=await fetch(fileUrl);
    if(!audio.ok||!audio.body)throw new Error(`Server audio membalas HTTP ${audio.status}`);
    res.setHeader('content-type',audio.headers.get('content-type')||'audio/mpeg');
    res.setHeader('content-disposition',`attachment; filename="gudang-lagu-${videoId}.mp3"`);
    const {Readable}=await import('node:stream');Readable.fromWeb(audio.body).pipe(res);
  }catch(e){res.status(502).json({error:e.message})}
});

function rapidHeaders(){return {'x-rapidapi-host':MEDIA_HOST,'x-rapidapi-key':RAPID_KEY,accept:'application/json'}}
app.post('/api/media/download',async(req,res)=>{
  const platform=String(req.body?.platform||'').toLowerCase();
  const url=String(req.body?.url||'').trim();
  const format=String(req.body?.format||'mp3').toLowerCase();
  if(!['youtube','tiktok','instagram'].includes(platform))return res.status(400).json({error:'Pilih YouTube, TikTok, atau Instagram.'});
  if(!/^https?:\/\//i.test(url))return res.status(400).json({error:'Masukkan URL video yang valid.'});
  if(!RAPID_KEY)return res.status(503).json({error:'RAPIDAPI_KEY belum dipasang pada environment backend.'});
  try{
    let endpoint,init;
    if(platform==='youtube'){
      if(!['mp3','144p','240p','360p','480p','720p','1080p','1440p','2160p'].includes(format))return res.status(400).json({error:'Format YouTube tidak didukung.'});
      endpoint=`https://${MEDIA_HOST}/youtube/download`;
      init={method:'POST',headers:{...rapidHeaders(),'content-type':'application/json'},body:JSON.stringify({url,format})};
    }else{
      endpoint=`https://${MEDIA_HOST}/fetch?url=${encodeURIComponent(url)}`;
      init={headers:rapidHeaders()};
    }
    const upstream=await fetch(endpoint,init);const data=await upstream.json().catch(()=>null);
    if(!upstream.ok||data?.ok===false||data?.success===false)return res.status(upstream.status===200?502:upstream.status).json({error:data?.message||data?.error||`RapidAPI HTTP ${upstream.status}`});
    const downloadUrl=data?.download_url||data?.download||data?.url||data?.data?.download_url||data?.data?.download||data?.data?.url;
    if(typeof downloadUrl!=='string')return res.status(502).json({error:'API berhasil merespons tetapi field URL download tidak ditemukan.',response:data});
    let parsed;try{parsed=new URL(downloadUrl)}catch{return res.status(502).json({error:'URL download dari API tidak valid.'})}
    if(!['https:','http:'].includes(parsed.protocol))return res.status(502).json({error:'Protokol URL hasil download tidak valid.'});
    res.json({ok:true,platform,format,download_url:parsed.href,filename:data?.filename||data?.data?.filename||null,title:data?.title||data?.data?.title||null,thumbnail:data?.thumbnail||data?.data?.thumbnail||null});
  }catch(e){res.status(502).json({error:e.message||'Gagal menghubungi RapidAPI.'})}
});

app.listen(port,'0.0.0.0',()=>console.log(`Gudang Lagu Gilang listening on ${port}`));
