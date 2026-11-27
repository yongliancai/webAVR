// Display geometry only. Stored map coordinates stay normalized and unchanged.
export function fitMap(width,height,imageWidth,imageHeight,padding=48){
 const w=Math.max(1,width-padding*2),h=Math.max(1,height-padding*2),ratio=imageWidth>0&&imageHeight>0?imageWidth/imageHeight:1;
 const fittedWidth=Math.min(w,h*ratio);
 return {width:Math.max(1,Math.floor(fittedWidth)),height:Math.max(1,Math.floor(fittedWidth/ratio))};
}
export function mapPoint(clientX,clientY,rect){
 if(rect.width<=0||rect.height<=0)return null;
 const x=(clientX-rect.left)/rect.width,y=(clientY-rect.top)/rect.height;
 if(x<0||x>1||y<0||y>1)return null;
 return {x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000};
}
