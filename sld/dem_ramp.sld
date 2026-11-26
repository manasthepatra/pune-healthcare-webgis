<?xml version="1.0" encoding="UTF-8"?>
<!-- Elevation colour ramp for the SRTM DEM coverage (metres). Range 525-650 m = this area's SRTM values; no-data pixels are skipped by the coverage's own nodata value. -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>dem</Name>
    <UserStyle>
      <Title>DEM elevation ramp</Title>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>0.75</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#1a9850" quantity="525" label="525 m"/>
              <ColorMapEntry color="#a6d96a" quantity="550" label="550 m"/>
              <ColorMapEntry color="#ffffbf" quantity="575" label="575 m"/>
              <ColorMapEntry color="#fdae61" quantity="610" label="610 m"/>
              <ColorMapEntry color="#d73027" quantity="650" label="650 m"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
