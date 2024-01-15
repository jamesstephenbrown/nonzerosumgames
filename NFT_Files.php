<?php
$dir    = '/images';
$files = scandir($dir);
$images = array();
foreach($files as $file) {
  if(fnmatch('*.jpg',$file)) {
    $images[] = $file;
  }
}

foreach($images as $image) {
  echo '<img src="Images/NFTs/'.$image.'" />';
}
?>