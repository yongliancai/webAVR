export function choosePanoramaWidth({coarse=false,width=1280,memory=8,maxTexture=4096}={}){
 const desired=coarse||width<=1024||memory<=4?2048:4096;
 return maxTexture<2048?1024:Math.min(desired,maxTexture<4096?2048:4096);
}
let textureLimit;
export function deviceTextureLimit(){
 if(textureLimit)return textureLimit;
 try{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');textureLimit=gl?gl.getParameter(gl.MAX_TEXTURE_SIZE):2048;if(!Number.isFinite(textureLimit)||textureLimit<1)textureLimit=2048;gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{textureLimit=2048;}
 return textureLimit;
}
export function panoramaWidth(quality,device){const cap=choosePanoramaWidth({...device,coarse:false,width:2000,memory:8});return quality==='auto'?choosePanoramaWidth(device):Math.min(Number(quality),cap);}
