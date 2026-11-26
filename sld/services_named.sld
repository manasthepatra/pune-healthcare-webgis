<?xml version="1.0" encoding="UTF-8"?>
<!-- Rule-based style for the services layer: named vs unnamed, hospitals drawn larger. -->
<StyledLayerDescriptor version="1.0.0"
  xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>services</Name>
    <UserStyle>
      <Title>Services: named vs unnamed</Title>
      <FeatureTypeStyle>

        <Rule>
          <Title>Named hospital</Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo><ogc:PropertyName>name_status</ogc:PropertyName><ogc:Literal>named</ogc:Literal></ogc:PropertyIsEqualTo>
              <ogc:PropertyIsEqualTo><ogc:PropertyName>service_type</ogc:PropertyName><ogc:Literal>hospital</ogc:Literal></ogc:PropertyIsEqualTo>
            </ogc:And>
          </ogc:Filter>
          <PointSymbolizer>
            <Graphic><Mark><WellKnownName>circle</WellKnownName>
              <Fill><CssParameter name="fill">#1d4ed8</CssParameter></Fill>
              <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
            </Mark><Size>13</Size></Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Title>Named (clinic, doctors, other)</Title>
          <ogc:Filter>
            <ogc:And>
              <ogc:PropertyIsEqualTo><ogc:PropertyName>name_status</ogc:PropertyName><ogc:Literal>named</ogc:Literal></ogc:PropertyIsEqualTo>
              <ogc:PropertyIsNotEqualTo><ogc:PropertyName>service_type</ogc:PropertyName><ogc:Literal>hospital</ogc:Literal></ogc:PropertyIsNotEqualTo>
            </ogc:And>
          </ogc:Filter>
          <PointSymbolizer>
            <Graphic><Mark><WellKnownName>circle</WellKnownName>
              <Fill><CssParameter name="fill">#3b82f6</CssParameter></Fill>
              <Stroke><CssParameter name="stroke">#ffffff</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
            </Mark><Size>8</Size></Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Title>Unnamed (no name tag in OSM)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo><ogc:PropertyName>name_status</ogc:PropertyName><ogc:Literal>unnamed</ogc:Literal></ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <PointSymbolizer>
            <Graphic><Mark><WellKnownName>triangle</WellKnownName>
              <Fill><CssParameter name="fill">#f97316</CssParameter></Fill>
              <Stroke><CssParameter name="stroke">#7c2d12</CssParameter><CssParameter name="stroke-width">1</CssParameter></Stroke>
            </Mark><Size>9</Size></Graphic>
          </PointSymbolizer>
        </Rule>

        <Rule>
          <Title>Names (zoomed in)</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo><ogc:PropertyName>name_status</ogc:PropertyName><ogc:Literal>named</ogc:Literal></ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>20000</MaxScaleDenominator>
          <TextSymbolizer>
            <Label><ogc:PropertyName>name</ogc:PropertyName></Label>
            <Font>
              <CssParameter name="font-family">Arial</CssParameter>
              <CssParameter name="font-size">10</CssParameter>
            </Font>
            <LabelPlacement><PointPlacement>
              <AnchorPoint><AnchorPointX>0</AnchorPointX><AnchorPointY>0.5</AnchorPointY></AnchorPoint>
              <Displacement><DisplacementX>9</DisplacementX><DisplacementY>0</DisplacementY></Displacement>
            </PointPlacement></LabelPlacement>
            <Halo><Radius>1.5</Radius><Fill><CssParameter name="fill">#ffffff</CssParameter></Fill></Halo>
            <Fill><CssParameter name="fill">#111827</CssParameter></Fill>
          </TextSymbolizer>
        </Rule>

      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
